/**
 * Compatibility adapter：把现有 Main service/store 委托给 Runtime 门面。
 *
 * 删除期限：
 * - Session catalog 已在 K03 改为注入；legacy 消息委托在 K05 删除。
 * - orchestrator 已在 K08 退出生产 Run；permission、plan、question 委托按后续 Slice 删除。
 * - 该文件不得成为第二个长期应用门面。
 */
import {
  createRunCoordinator,
  createContextService,
  createAgentRuntime,
  type AgentRuntime,
  type AgentEngine,
  type AgentInvocation,
  type AskUserBroker,
  type ChannelService,
  type ContextCompactor,
  type PermissionAskBroker,
  type PlanAskBroker,
  type PermissionRuleRepository,
  type ProfileService,
  type ProviderCatalog,
  type RunRepository,
  type ArtifactRepository,
  type BlobCleanup,
  type DelegationService,
  type DelegationRepository,
  mountFailureMessage,
  resolveModelSelection,
  resolveProfileSkills,
  type SessionCommands,
  type SessionMessageHistory,
  type SessionTitleService,
  type SecretStore,
  type SkillCatalog,
  type McpManager,
  type ToolRegistry,
  type WorkspaceCommands,
} from '../../runtime/index.ts'
import { createDelegationService } from '../../runtime/index.ts'
import { formatSkillsSystemPrompt } from '../../kernel/pi/index.ts'
import type { PermissionMode } from '../../shared/contracts/permission.ts'
import type { StartRunInput } from '../../shared/contracts/run.ts'

export interface CreateLegacyRuntimeOptions {
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  /** FR05A：首条 root 消息标题生成，失败不得阻塞 Run。 */
  sessionTitles?: SessionTitleService
  history: SessionMessageHistory
  agentEngine: AgentEngine
  contextCompactor: ContextCompactor
  /** S06：授权请求由 Runtime broker 持有；respond/pending/clearSession 都走它 */
  permissions: PermissionAskBroker
  /** S09：计划审批由 Runtime broker 持有；respond/pending/clearSession 都走它 */
  plans: PlanAskBroker
  /** S10：用户问答由 Runtime broker 持有；respond/pending/clearSession 都走它 */
  questions: AskUserBroker
  /** S07：规则持久化仓库（SQLite），同时服务策略引擎与规则列表 IPC */
  rules: PermissionRuleRepository
  /**
   * C01：密钥存储。C02 起渠道密钥经 ChannelService 写入该 store，
   * 明文不再进入 SQLite/JSON。
   */
  secretStore: SecretStore
  /** C02：渠道 CRUD 与运行期解析（密钥只存 ref） */
  channels: ChannelService
  /** C03：渠道连通性与模型发现（pi adapter，错误映射为稳定诊断码） */
  providerCatalog: ProviderCatalog
  /** C04：命名模型配置预设，Run 启动时固化为不可变快照 */
  profiles: ProfileService
  /** C07：技能目录发现（内置/用户级/工作区） */
  skills: SkillCatalog
  /** C09：MCP 服务配置与连接状态（传输实现由 Composition Root 注入） */
  mcp: McpManager
  /** C12：Run 账本持久化（能力快照 + token/cost） */
  runs?: RunRepository
  delegations?: DelegationRepository
  /** A05：Artifact 索引（结果区列表数据源） */
  artifacts?: ArtifactRepository
  /** A09：会话删除后清理无引用 Blob */
  blobCleanup?: BlobCleanup
  /** D02：delegate 服务注入位（engine tools 闭包经此引用读取） */
  delegationRef?: { service?: DelegationService }
  createRunId?(): string
  /** C12：工具注册表快照在 Run 启动时冻结 */
  toolRegistry: ToolRegistry
  dispose?(): Promise<void>
}

export function createLegacyRuntime(
  options: CreateLegacyRuntimeOptions,
): AgentRuntime {
  const context = createContextService({
    sessions: options.sessions,
    history: options.history,
    // 压缩摘要需要真实 apiKey 构建 pi Provider，因此这里用运行期解析结果。
    channels: { list: () => options.channels.resolveAll() },
    compactor: options.contextCompactor,
  })
  const runs = createRunCoordinator({
    now: Date.now,
    engine: options.agentEngine,
    // D03：父会话停止 → 级联停止其 child run（服务在下方装配，闭包运行期读取）
    onStop: (sessionId) => {
      options.delegationRef?.service?.stopCascade(sessionId)
    },
    createInvocation: (input) =>
      createAgentInvocation(
        input,
        options.sessions,
        options.workspaces,
        options.channels,
        options.profiles,
        options.skills,
        options.toolRegistry,
      ),
    context,
    runs: options.runs,
    createRunId: options.createRunId,
    lifecycle: {
      async started(sessionId) {
        return requireSessionUpdate(
          sessionId,
          options.sessions.updateMeta(sessionId, {
            status: 'running',
            statusDetail: undefined,
            lastActivity: '正在思考…',
          }),
        )
      },
      async settled(settlement) {
        options.permissions.clearSession(settlement.sessionId)
        options.plans.clearSession(settlement.sessionId)
        options.questions.clearSession(settlement.sessionId)
        return requireSessionUpdate(
          settlement.sessionId,
          options.sessions.updateMeta(settlement.sessionId, {
            status: settlement.status,
            statusDetail: settlement.detail
              ? shortReason(settlement.detail)
              : undefined,
            lastActivity: undefined,
          }),
        )
      },
    },
  })
  if (options.delegationRef) {
    options.delegationRef.service = createDelegationService({
      sessions: options.sessions,
      coordinator: runs,
      runs: options.runs,
      tasks: options.delegations,
      createId: options.createRunId ?? (() => `child-${Date.now()}`),
      now: Date.now,
    })
  }
  return createAgentRuntime({
    workspaces: options.workspaces,
    sessions: options.blobCleanup
      ? {
          ...options.sessions,
          delete: async (sessionId) => {
            await options.sessions.delete(sessionId)
            await options.blobCleanup?.deleteSession(sessionId)
          },
        }
      : options.sessions,
    sessionTitles: options.sessionTitles,
    runs,
    permissions: {
      respond: async (response) => {
        await options.permissions.respond(response)
      },
      pending: options.permissions.pending,
      expireSessionRules(sessionId) {
        for (const rule of options.rules.list()) {
          if (rule.scope === 'session' && rule.ownerId === sessionId) {
            options.rules.remove(rule.id)
          }
        }
      },
      listRules: () => options.rules.list(),
      removeRule: (id) => options.rules.remove(id),
    },
    plans: {
      respond: (response) => options.plans.respond(response),
      pending: options.plans.pending,
      // 模式是 Session 元数据：AgentRuntime 门面在调用后经 updateMeta 持久化，
      // 策略引擎直接读 catalog，这里不再维护第二份 Map。
      setMode: () => {},
    },
    questions: {
      respond: (response) => options.questions.respond(response),
      pending: options.questions.pending,
    },
    context: {
      start: context.start,
      defer: context.defer,
      cancel: context.cancel,
      clearSession: context.clearSession,
    },
    artifacts: {
      list: (sessionId) => options.artifacts?.bySession(sessionId) ?? [],
    },
    capabilities: {
      list: () => [],
    },
    settings: {
      listChannels: () => options.channels.list(),
      saveChannel: (channel) => {
        options.channels.save(channel)
      },
      deleteChannel: (channelId) => {
        options.channels.delete(channelId)
      },
      async testChannel(channelId) {
        let channel
        try {
          channel = options.channels.resolve(channelId)
        } catch (error) {
          return {
            ok: false,
            code: 'auth_failed',
            message: error instanceof Error ? error.message : String(error),
          }
        }
        if (!channel) {
          return {
            ok: false,
            code: 'bad_config',
            message: '渠道不存在或尚未保存密钥',
          }
        }
        try {
          const result = await options.providerCatalog.discover({ channel })
          if (!result.ok) return result
          const saved = options.channels.applyDiscoveredModels(
            channelId,
            result.models,
          )
          return {
            ok: true,
            code: 'ok',
            message: `连接成功，发现 ${result.models.length} 个模型`,
            models: saved.models,
          }
        } catch (error) {
          return {
            ok: false,
            code: 'unknown',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      },
      listProfiles: () => options.profiles.list(),
      saveProfile: (profile) => {
        options.profiles.save(profile)
      },
      deleteProfile: (profileId) => {
        options.profiles.delete(profileId)
      },
      // 工具权限只读展示：权限由描述符内置分类派生，配置入口在权限模式与规则
      listTools: () =>
        options.toolRegistry.list().map((descriptor) => ({
          id: descriptor.id,
          name: descriptor.name,
          label: descriptor.label,
          description: descriptor.description,
          category: descriptor.category,
          source: descriptor.source,
          enabled: descriptor.enabled,
          permission: descriptor.defaultPermission,
          ...(descriptor.note ? { note: descriptor.note } : {}),
        })),
      listSkills: (workspaceId) => options.skills.groups(workspaceId),
      setSkillEnabled: (skillId, enabled) => {
        options.skills.setEnabled(skillId, enabled)
      },
      listMcpServers: () => options.mcp.list(),
      saveMcpServer: (config) => {
        options.mcp.save(config)
      },
      deleteMcpServer: (serverId) => {
        options.mcp.delete(serverId)
      },
      connectMcp: (serverId) => options.mcp.connect(serverId),
      disconnectMcp: (serverId) => options.mcp.disconnect(serverId),
      mcpStatuses: () => options.mcp.statuses(),
    },
    async dispose() {
      context.dispose()
      await runs.dispose()
      await options.mcp.dispose()
      await options.dispose?.()
    },
  })
}

async function createAgentInvocation(
  input: StartRunInput,
  sessions: SessionCommands,
  workspaces: WorkspaceCommands,
  channels: ChannelService,
  profiles: ProfileService,
  skills: SkillCatalog,
  toolRegistry: ToolRegistry,
): Promise<AgentInvocation> {
  const meta = sessions.get(input.sessionId)
  if (!meta) throw new Error(`会话不存在：${input.sessionId}`)

  // C04：Run 启动时固化模型选择快照，禁止中途读全局 mutable settings。
  const selection = resolveModelSelection(meta, profiles)

  // 运行期解析会带回明文 apiKey（只在内核调用前存在内存里）。
  const channel = channels.resolve(selection?.channelId) ?? channels.resolve()
  if (!channel) {
    throw new Error(
      '还没有配置任何渠道。请先在设置中配置模型渠道',
    )
  }

  const modelId = selection?.modelId || channel.models[0]?.id
  if (!modelId) throw new Error(`渠道「${channel.name}」下没有可用模型`)
  if (!channel.models.some((model) => model.id === modelId)) {
    throw new Error(`模型未注册：${channel.id}/${modelId}，请先在设置中刷新模型列表`)
  }

  const mode = meta.permissionMode ?? 'auto'
  if (!meta.workspaceId) {
    throw new Error('会话没有关联工作区，请先选择工作区')
  }
  const mount = workspaces.mountStatus(meta.workspaceId)
  if (!mount.ok) {
    throw new Error(mountFailureMessage(mount))
  }
  const workspaceDir = mount.mount.path
  // C08：Run 启动时冻结启用技能摘要；正文只在 Agent 调用 skill 工具时加载。
  const allEnabledSkills = skills
    .list(meta.workspaceId)
    .filter((skill) => skill.enabled)
  const enabledSkills = resolveProfileSkills(allEnabledSkills, selection?.skillIds)
  // C12：Run 启动时冻结工具快照（含 MCP 与内置），作为能力账本来源。
  const frozenTools = toolRegistry.snapshot().filter((tool) =>
    input.identity?.role !== 'explorer'
    || ['read', 'glob', 'grep'].includes(tool.id)
  )
  if (!input.identity) {
    throw new Error('Run 身份未预留，拒绝启动 Agent')
  }
  const profileSnapshot = selection?.profileId
    ? (() => {
        const profile = profiles.get(selection.profileId!)
        return profile
          ? {
              id: profile.id,
              name: profile.name,
              channelId: profile.channelId,
              modelId: profile.modelId,
            }
          : undefined
      })()
    : undefined

  return {
    sessionId: input.sessionId,
    text: input.text,
    subject: input.identity,
    permissionCeiling: {
      schemaVersion: 1,
      policyVersion: 'permission-v2',
      mode,
      rootSessionId: input.identity.rootSessionId,
      workspaceId: meta.workspaceId,
      mountRevision: String(mount.mount.resolvedAt),
      allowedToolIds: [
        ...frozenTools.map((tool) => tool.id),
        'ask_user',
        'exit_plan_mode',
        ...(input.identity.role === 'root' ? ['delegate_to_agent'] : []),
        'skill',
      ],
      maxAutoRisk: mode === 'plan' ? 'R1' : 'R3',
      role: input.identity.role,
    },
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    workspaceId: meta.workspaceId,
    cwd: workspaceDir,
    channel,
    modelId,
    skills: enabledSkills,
    tools: frozenTools,
    ...(input.lineage ? { lineage: input.lineage } : {}),
    ...(input.lineage?.parentSessionId
      ? { policySessionId: input.lineage.parentSessionId }
      : {}),
    ...(profileSnapshot ? { profile: profileSnapshot } : {}),
    systemPrompt:
      buildSystemPrompt(workspaceDir, mode, enabledSkills, selection?.systemPrompt),
  }
}

export function buildSystemPrompt(
  workspaceDir: string,
  mode: PermissionMode,
  skills: ReturnType<SkillCatalog['list']> = [],
  profileInstructions?: string,
): string {
  return [
    '你是 TgBuddy 的 Agent 助手。回答简洁准确，中文优先。',
    '',
    '## 工作区',
    `当前工作目录：${workspaceDir}`,
    ...(profileInstructions
      ? [
          '',
          '## 专家指令',
          profileInstructions,
        ]
      : []),
    ...(mode === 'plan'
      ? [
          '',
          '## 计划模式',
          '当前只分析问题并给出实施计划，不执行会改变工作区的操作。',
        ]
      : []),
    ...(skills.length > 0
      ? [
          '',
          '## 技能',
          // 复用 pi 的 formatSkillsForSystemPrompt：
          // name + description + location 进 system prompt，正文仍按需加载。
          formatSkillsSystemPrompt(skills),
        ]
      : []),
  ].join('\n')
}

function requireSessionUpdate(
  sessionId: string,
  session: ReturnType<SessionCommands['updateMeta']>,
): NonNullable<ReturnType<SessionCommands['updateMeta']>> {
  if (!session) throw new Error(`会话不存在：${sessionId}`)
  return session
}

function shortReason(message: string): string {
  const firstLine = message.split('\n')[0] ?? message
  if (/401|authentication/i.test(firstLine)) return '认证失败'
  if (/429|rate.?limit/i.test(firstLine)) return '请求限流'
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(firstLine)) return '网络超时'
  if (/渠道|模型未注册/.test(firstLine)) return '渠道配置有误'
  return firstLine.length > 40
    ? `${firstLine.slice(0, 40)}…`
    : firstLine
}
