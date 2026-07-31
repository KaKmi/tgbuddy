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
  type ContextCompactor,
  type PermissionAskBroker,
  type PermissionRuleRepository,
  mountFailureMessage,
  type SessionCommands,
  type SessionMessageHistory,
  type WorkspaceCommands,
} from '../../runtime/index.ts'
import type { PermissionMode } from '../../shared/contracts/permission.ts'
import type { StartRunInput } from '../../shared/contracts/run.ts'
import * as askUser from '../ask-user-service.ts'
import {
  ensureDataDir,
  listChannels,
  saveChannels,
} from '../channel-store.ts'
import * as permission from '../permission-service.ts'
import * as plan from '../plan-service.ts'

export interface CreateLegacyRuntimeOptions {
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  history: SessionMessageHistory
  agentEngine: AgentEngine
  contextCompactor: ContextCompactor
  /** S06：授权请求由 Runtime broker 持有；respond/pending/clearSession 都走它 */
  permissions: PermissionAskBroker
  /** S07：规则持久化仓库（SQLite），同时服务策略引擎与规则列表 IPC */
  rules: PermissionRuleRepository
  dispose?(): Promise<void>
}

export function createLegacyRuntime(
  options: CreateLegacyRuntimeOptions,
): AgentRuntime {
  ensureDataDir()
  const context = createContextService({
    sessions: options.sessions,
    history: options.history,
    channels: { list: listChannels },
    compactor: options.contextCompactor,
  })
  const runs = createRunCoordinator({
    now: Date.now,
    engine: options.agentEngine,
    createInvocation: (input) =>
      createAgentInvocation(input, options.sessions, options.workspaces),
    context,
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
        plan.clearSession(settlement.sessionId)
        askUser.clearSession(settlement.sessionId)
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
  return createAgentRuntime({
    workspaces: options.workspaces,
    sessions: options.sessions,
    runs,
    permissions: {
      respond: (response) => options.permissions.respond(response),
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
      respond: plan.respond,
      pending: plan.getPending,
      setMode: permission.setMode,
    },
    questions: {
      respond: askUser.respond,
      pending: askUser.getPending,
    },
    context: {
      start: context.start,
      defer: context.defer,
      cancel: context.cancel,
      clearSession: context.clearSession,
    },
    artifacts: {
      list: () => [],
    },
    capabilities: {
      list: () => [],
    },
    settings: {
      listChannels,
      saveChannel(channel) {
        const channels = listChannels().filter((item) => item.id !== channel.id)
        saveChannels([...channels, channel])
      },
      deleteChannel(channelId) {
        saveChannels(listChannels().filter((item) => item.id !== channelId))
      },
      async testChannel(_channelId) {
        return { success: false, message: '未实现' }
      },
    },
    async dispose() {
      context.dispose()
      await runs.dispose()
      await options.dispose?.()
    },
  })
}

async function createAgentInvocation(
  input: StartRunInput,
  sessions: SessionCommands,
  workspaces: WorkspaceCommands,
): Promise<AgentInvocation> {
  const meta = sessions.list().find((session) => session.id === input.sessionId)
  if (!meta) throw new Error(`会话不存在：${input.sessionId}`)

  const channels = listChannels()
  if (channels.length === 0) {
    throw new Error(
      '还没有配置任何渠道。请先在设置中配置模型渠道',
    )
  }
  const channel = channels.find((item) => item.id === meta.channelId)
    ?? channels[0]
  if (!channel) throw new Error('没有可用渠道')

  const modelId = meta.modelId ?? channel.models[0]?.id
  if (!modelId) throw new Error(`渠道「${channel.name}」下没有可用模型`)
  if (!channel.models.some((model) => model.id === modelId)) {
    throw new Error(`模型未注册：${channel.id}/${modelId}`)
  }

  const mode = meta.permissionMode ?? 'auto'
  permission.setMode(input.sessionId, mode)
  if (!meta.workspaceId) {
    throw new Error('会话没有关联工作区，请先选择工作区')
  }
  const mount = workspaces.mountStatus(meta.workspaceId)
  if (!mount.ok) {
    throw new Error(mountFailureMessage(mount))
  }
  const workspaceDir = mount.mount.path

  return {
    sessionId: input.sessionId,
    text: input.text,
    workspaceId: meta.workspaceId,
    cwd: workspaceDir,
    channel,
    modelId,
    systemPrompt: buildSystemPrompt(workspaceDir, mode),
  }
}

function buildSystemPrompt(
  workspaceDir: string,
  mode: PermissionMode,
): string {
  return [
    '你是 TgBuddy 的 Agent 助手。回答简洁准确，中文优先。',
    '',
    '## 工作区',
    `当前工作目录：${workspaceDir}`,
    ...(mode === 'plan'
      ? [
          '',
          '## 计划模式',
          '当前只分析问题并给出实施计划，不执行会改变工作区的操作。',
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
