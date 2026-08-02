import { safeStorage, shell, type BrowserWindow } from 'electron'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { realpath, readdir, stat, unlink } from 'node:fs/promises'
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path'
import {
  createAskUserBroker,
  createBuiltinToolRegistry,
  createChannelService,
  createBlobCleanup,
  createMcpManager,
  createPlanAskBroker,
  createPermissionAskBroker,
  createPolicyEngine,
  createInvocationNormalizer,
  createInvocationIdentityBinder,
  createRiskClassifier,
  createRunAuthorizationGate,
  PermissionRuleIndex,
  createProfileService,
  createSessionCommands,
  createSessionTitleService,
  createSessionMessageHistory,
  createWorkspaceService,
  projectArtifact as projectArtifactSummary,
  recoverInterruptedRuns,
  resolveModelSelection,
  type AgentRuntime,
  type InterruptedRunRecoveryReport,
  type SessionTitleService,
} from '../../runtime/index.ts'
import {
  AppDatabase,
  SqliteChannelRepository,
  SqliteMcpConfigRepository,
  SqlitePermissionRuleRepository,
  SqlitePlanEffectRepository,
  SqliteInteractionDecisionWriter,
  SqliteProfileRepository,
  SqliteRunRepository,
  SqliteSessionRepository,
  SqliteAttachmentRepository,
  SqliteArtifactRepository,
  SqliteBlobRefRepository,
  SqliteWorkspaceRepository,
} from '../../infrastructure/sqlite/index.ts'
import { createNodeFsBlobStore } from '../../infrastructure/blob/index.ts'
import { EncryptedFileSecretStore } from '../../infrastructure/secrets/index.ts'
import { SdkMcpTransportFactory } from '../../infrastructure/mcp/index.ts'
import {
  createFsSkillCatalog,
  createFsSkillLoader,
  seedBuiltinSkills,
} from '../../infrastructure/skills/index.ts'
import { NodeWorkspaceMountResolver } from '../../infrastructure/workspace/index.ts'
import {
  buildAskUserTool,
  buildBuiltinTools,
  buildMcpTool,
  buildPlanModeTools,
  buildSkillTool,
  buildDelegateTool,
  createPiAgentEngine,
  createPiContextCompactor,
  createPiProviderCatalog,
  createPiSessionStore,
  createPiTitleGenerator,
  PiRunExecutionEnvFactory,
} from '../../kernel/pi/index.ts'
import { registerIpc, type ArtifactIo, type AttachmentIo } from '../ipc.ts'
import { createArtifactIo } from '../artifact-io.ts'
import { randomUUID } from 'node:crypto'
import {
  markLegacyChannelsMigrated,
  readLegacyChannels,
} from '../legacy-channels.ts'
import { createId } from './create-id.ts'
import { createLegacyRuntime } from './create-legacy-runtime.ts'
import {
  importLegacySessions,
  type LegacyMigrationReport,
} from './import-legacy-sessions.ts'
import { IPC } from '../../shared/contracts/ipc.ts'

export interface CreateApplicationOptions {
  getWindow(): BrowserWindow | null
  databasePath: string
  legacyDataDir: string
}

export interface TgBuddyApplication {
  agentRuntime: AgentRuntime
  migration: LegacyMigrationReport
  recovery: InterruptedRunRecoveryReport
  dispose(): Promise<void>
}

/**
 * Electron 唯一 Composition Root。后续 Story 只替换这里的 adapter 装配。
 */
export async function createApplication(
  options: CreateApplicationOptions,
): Promise<TgBuddyApplication> {
  const appDatabase = AppDatabase.open(options.databasePath)
  const sessionRepository = new SqliteSessionRepository(appDatabase)
  const workspaceRepository = new SqliteWorkspaceRepository(appDatabase)
  // S07：用户「总是允许」规则是资产，落 SQLite 跨重启保留。
  const permissionRules = new SqlitePermissionRuleRepository(appDatabase)
  const permissionRuleIndex = new PermissionRuleIndex({
    revision: 1,
    rules: permissionRules.list(),
  })
  const planEffects = new SqlitePlanEffectRepository(appDatabase)
  const interactionDecisionWriter = new SqliteInteractionDecisionWriter(appDatabase, {
    createId,
    now: Date.now,
    onPermissionRuleCommitted() {
      const currentRules = permissionRuleIndex.current()
      permissionRuleIndex.replaceCommitted({
        revision: currentRules.revision + 1,
        rules: permissionRules.list(),
      })
    },
  })
  const channelRepository = new SqliteChannelRepository(appDatabase)
  const profileRepository = new SqliteProfileRepository(appDatabase)
  // C01：渠道密钥只经 SecretStore 保存；SQLite 只存 secret ref。
  // 加密原语用 Electron safeStorage（Windows DPAPI / macOS Keychain），
  // 磁盘上只有加密 blob，测试不触碰真实系统凭据。
  const secretStore = new EncryptedFileSecretStore({
    cipher: safeStorage,
    filePath: join(dirname(options.databasePath), 'secrets.json'),
  })
  const profiles = createProfileService({
    repository: profileRepository,
    createId,
    now: Date.now,
  })
  // C12：每个 Run 持久化能力快照与 token/cost 账本。
  const runs = new SqliteRunRepository(appDatabase)
  // A01/A02：内容寻址 BlobStore（附件/长输出/产物），物理文件在 userData/blobs。
  const blobStore = createNodeFsBlobStore({
    root: join(options.legacyDataDir, 'blobs'),
  })
  const attachmentRepository = new SqliteAttachmentRepository(appDatabase)
  const artifactRepository = new SqliteArtifactRepository(appDatabase)
  const blobRefRepository = new SqliteBlobRefRepository(appDatabase)
  const blobCleanup = createBlobCleanup({
    blobs: blobStore,
    refs: blobRefRepository,
    listTmpFiles: async () => {
      try {
        const entries = await readdir(join(options.legacyDataDir, 'blobs'))
        return entries.filter((name) => name.includes('.tmp-'))
      } catch {
        return []
      }
    },
    deleteFile: (fileName) =>
      unlink(join(options.legacyDataDir, 'blobs', fileName)),
  })
  // A09：启动时清理孤儿 blob 与崩溃残留临时文件（幂等，失败不阻塞启动）
  void blobCleanup.sweepOrphans().then((result) => {
    if (result.removed.length > 0 || result.tmpRemoved.length > 0) {
      console.info(
        `[blob] 启动清理：孤儿 ${result.removed.length}、临时文件 ${result.tmpRemoved.length}`,
      )
    }
  }).catch((error: unknown) => {
    console.error('[blob] 启动清理失败：', error)
  })
  const channels = createChannelService({
    repository: channelRepository,
    secrets: secretStore,
    sessions: sessionRepository,
    profiles,
    createId,
  })
  migrateLegacyChannels(channels, channelRepository)
  const generatedTitles = createSessionTitleService({
    sessions: sessionRepository,
    generator: createPiTitleGenerator({
      resolveChannel(channelId) {
        try {
          return channels.resolve(channelId) ?? channels.resolve()
        } catch {
          return undefined
        }
      },
    }),
    now: Date.now,
  })
  const sessionTitles: SessionTitleService = {
    request(input) {
      const session = sessionRepository.get(input.sessionId)
      const selection = session
        ? resolveModelSelection(session, profiles)
        : undefined
      return generatedTitles.request({
        ...input,
        ...(selection?.channelId ? { channelId: selection.channelId } : {}),
        ...(selection?.modelId ? { modelId: selection.modelId } : {}),
      })
    },
  }
  // C07：技能目录。内置技能先 seed 到用户级全局目录（幂等、不覆盖用户修改），
  // 设置页「内置技能」组读全局副本；用户级技能同目录；工作区级随 mount。
  const userSkillsDir = join(options.legacyDataDir, 'skills')
  const builtinSeed = seedBuiltinSkills({
    sourceRoots: [join(process.cwd(), 'assets', 'skills', 'builtin')],
    targetRoot: userSkillsDir,
  })
  if (builtinSeed.seeded.length > 0) {
    console.info(`[skills] 已 seed 内置技能：${builtinSeed.seeded.join('、')}`)
  }
  const skills = createFsSkillCatalog({
    userRoots: [userSkillsDir],
    workspaceRoots: (workspaceId) => {
      const mount = workspaceService.mountStatus(workspaceId)
      return mount.ok ? [join(mount.mount.path, '.tgbuddy', 'skills')] : []
    },
  })
  const skillLoader = createFsSkillLoader()
  // C05：内置工具统一注册，Run 启动按 snapshot 冻结启用集合。
  const toolRegistry = createBuiltinToolRegistry()
  // D02：delegate 服务由 createLegacyRuntime 注入（它持有 coordinator/sessions/runs）
  const delegationRef: { service?: import('../../runtime/delegation/delegation-service.ts').DelegationService } = {}
  // C09：MCP 服务配置落 SQLite，连接状态由 Runtime 持有；
  // stdio/http 传输由 SDK adapter（Main 侧能力）实现；
  // C10：发现的工具注册进统一 ToolRegistry。
  const mcp = createMcpManager({
    repository: new SqliteMcpConfigRepository(appDatabase),
    factory: new SdkMcpTransportFactory(),
    secrets: secretStore,
    toolRegistry,
    createId,
    now: Date.now,
  })
  const mountResolver = new NodeWorkspaceMountResolver()
  const workspaceService = createWorkspaceService({
    repository: workspaceRepository,
    sessions: sessionRepository,
    createId,
    now: Date.now,
    paths: {
      resolve: (path) => resolve(path),
      key: (path) => resolve(path).toLowerCase(),
      name: (path) => basename(resolve(path)) || '默认工作区',
    },
    mountResolver,
  })
  const invocationNormalizer = createInvocationNormalizer({
    policyVersion: 'permission-v2',
    async resolvePath(path) {
      const absolute = resolve(path)
      const canonical = await realpath(absolute).catch(() => absolute)
      const info = await stat(canonical).catch(() => undefined)
      const workspaceScope = workspaceService.list().some((workspace) => {
        const root = workspace.mount?.path
        if (!root) return false
        const key = resolve(root).toLowerCase()
        const target = canonical.toLowerCase()
        return target === key || target.startsWith(`${key}\\`)
      })
      return {
        kind: info ? (info.isDirectory() ? 'directory' : 'file') : 'missing',
        canonicalPath: canonical,
        identityHash: info
          ? `${canonical}:${info.size}:${info.mtimeMs}`
          : `missing:${canonical}`,
        scope: workspaceScope ? 'workspace' : 'outside',
      }
    },
    async resolveExecutionContext(input) {
      const ceiling = input.permissionCeiling
      if (!ceiling) throw new Error('permission_ceiling_required')
      const mount = workspaceService.mountStatus(ceiling.workspaceId)
      if (!mount.ok) throw new Error('workspace_mount_required')
      return {
        canonicalCwd: mount.mount.path,
        workspaceId: ceiling.workspaceId,
        mountRevision: ceiling.mountRevision,
        identityHash: `${ceiling.workspaceId}:${ceiling.mountRevision}:${mount.mount.path}`,
      }
    },
    async resolveMcpMethod(serverId, method) {
      const descriptor = toolRegistry.snapshot().find((tool) =>
        tool.category === 'mcp'
        && tool.name === `${serverId}.${method}`
      )
      if (!descriptor) return undefined
      return {
        permission: descriptor.defaultPermission === 'allow' ? 'read' : 'write',
        identityHash: `${descriptor.id}:${descriptor.owner}:${descriptor.defaultPermission}`,
      }
    },
  })
  const riskClassifier = createRiskClassifier({ policyVersion: 'permission-v2' })
  const invocationIdentityBinder = createInvocationIdentityBinder<string>()
  // S06：授权请求由 Runtime broker 持有，主进程只负责把请求推给渲染进程。
  // 旧 Main permission-service 的 pending 注册表不再接新请求（S11 删除）。
  const permissionAskBroker = createPermissionAskBroker({
    createId,
    emitRequest(request) {
      const win = options.getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.AGENT_STREAM, {
        sessionId: request.sessionId,
        runId: 0,
        payload: {
          channel: 'host',
          event: { type: 'permission_request', request },
        },
      })
    },
    decisionWriter: interactionDecisionWriter,
    buildRule(request, grant) {
      return {
        id: createId(),
        tool: request.toolName,
        match: grant.match,
        pattern: grant.pattern,
        scope: grant.scope,
        neverPersist: false,
        ownerId:
          grant.scope === 'session'
            ? request.sessionId
            : grant.scope === 'project'
              ? sessionRepository.get(request.sessionId)?.workspaceId
              : undefined,
        reason: '授权卡「总是允许」',
        source: 'user',
      }
    },
  })
  // S09：计划审批请求同样由 Runtime broker 持有（与权限共用 pending registry）。
  const planAskBroker = createPlanAskBroker({
    createId,
    emitRequest(request) {
      const win = options.getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.AGENT_STREAM, {
        sessionId: request.sessionId,
        runId: 0,
        payload: {
          channel: 'host',
          event: { type: 'plan_request', request },
        },
      })
    },
  })
  // S10：ask_user 的结构化问题同样由 Runtime broker 持有。
  const askUserBroker = createAskUserBroker({
    createId,
    emitRequest(request) {
      const win = options.getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.AGENT_STREAM, {
        sessionId: request.sessionId,
        runId: 0,
        payload: {
          channel: 'host',
          event: { type: 'ask_user_request', request },
        },
      })
    },
  })

  let messageStore: ReturnType<typeof createPiSessionStore> | undefined
  let agentRuntime: AgentRuntime
  let unsubscribe: () => void
  let migration: LegacyMigrationReport
  let recovery: InterruptedRunRecoveryReport
  try {
    migration = await importLegacySessions({
      legacyDataDir: options.legacyDataDir,
      databasePath: options.databasePath,
      repository: sessionRepository,
    })
    reportLegacyMigration(migration)
    // 默认工作区承接尚无 workspaceId 的既有会话（含 legacy 导入），
    // 保证 S01 之后侧栏不会把历史会话隐藏成数据丢失。
    // TGBUDDY_WORKSPACE_DIR 仅供 E2E 隔离 run cwd，生产默认仍是启动目录。
    workspaceService.ensureDefault(
      process.env.TGBUDDY_WORKSPACE_DIR ?? process.cwd(),
    )
    const createdMessageStore = createPiSessionStore({
      databasePath: options.databasePath,
      cwd: process.cwd(),
    })
    messageStore = createdMessageStore
    const messageHistory = createSessionMessageHistory({
      store: createdMessageStore,
      createId,
      now: Date.now,
      // A02：历史回放时按 entry_id 还原用户消息的附件 ref
      attachments: attachmentRepository,
    })
    recovery = await recoverInterruptedRuns({
      sessions: sessionRepository,
      history: messageHistory,
      createId,
      now: Date.now,
    })
    reportInterruptedRunRecovery(recovery)
    agentRuntime = createLegacyRuntime({
      agentEngine: createPiAgentEngine({
        authorizationGate: createRunAuthorizationGate(),
        sessions: createdMessageStore,
        envFactory: new PiRunExecutionEnvFactory(),
        // A02：用户消息落库后把附件 ref 挂到 app_attachments（按 entry_id）
        persistAttachments: (sessionId, entryId, refs) => {
          attachmentRepository.save(sessionId, entryId, refs)
          for (const ref of refs) {
            blobRefRepository.add(
              ref.blob.hash,
              'attachment',
              `${sessionId}:${entryId}:${ref.id}`,
            )
          }
        },
        // A03：模型调用前按 ref 读回附件字节（图片转 pi ImageContent）
        loadAttachment: (blob) => blobStore.get(blob),
        // A04：超长工具输出完整落 Blob，消息只存预览 + ref
        storeToolOutput: async (sessionId, toolCallId, text) => {
          const ref = await blobStore.put(new TextEncoder().encode(text), {
            mime: 'text/plain',
          })
          blobRefRepository.add(
            ref.hash,
            'tool-output',
            `${sessionId}:${toolCallId}`,
          )
          return ref
        },
        // A05：成功产出型工具 → Artifact 索引（同路径 upsert，替代旧 countArtifacts 推导）
        projectArtifact: (sessionId, workspaceId, input) => {
          const artifact = projectArtifactSummary({
            sessionId,
            workspaceId,
            toolName: input.toolName,
            args: input.args,
            isError: input.isError,
            createId,
            now: Date.now,
          })
          if (artifact) {
            artifactRepository.save(artifact)
            if (artifact.blob) {
              blobRefRepository.add(
                artifact.blob.hash,
                'artifact',
                `${artifact.sessionId}:${artifact.id}`,
              )
            }
          }
        },
        tools: (invocation, env) => {
          const sessionId = invocation.sessionId
          // C12：工具集只来自 Run 启动时冻结的 snapshot，
          // 运行中设置变更（enable/disable/MCP 断开）不影响本次 Run。
          const frozen = invocation.tools ?? toolRegistry.snapshot()
          const enabled = new Set(
            frozen.map((descriptor) => descriptor.name),
          )
          const tools: AgentTool[] = []
          // D02：child run 不加载 delegate 工具（深度 ≤1 由注入门控保证）；
          // 钩子绑定当前 invocation 的 session/workspace 供子任务使用。
          if (!invocation.lineage && delegationRef.service) {
            tools.push(
              buildDelegateTool({
                delegate: (task, toolCallId, _options, signal) =>
                  delegationRef.service!.delegate({
                    parentSessionId: invocation.sessionId,
                    workspaceId: invocation.workspaceId,
                    task,
                    parentToolCallId: toolCallId,
                    signal,
                  }),
              }),
            )
          }
          // 基础六工具：只在 snapshot 启用时保留，顺序稳定。
          for (const tool of buildBuiltinTools(invocation.cwd, {
            env,
            trashItem: (absPath) => shell.trashItem(absPath),
          })) {
            if (enabled.has(tool.name)) tools.push(tool)
          }
          // 计划模式已 skill 化：进入由用户模式 chip 显式切换，
          // 这里只注入宿主只读能力「提交计划」（同 skill 工具，不进工具区）。
          tools.push(...buildPlanModeTools({
            // 模式是 Session 元数据：读取与写入都直连 catalog，不再有第二份 Map。
            getMode: () =>
              sessionRepository.get(sessionId)?.permissionMode ?? 'auto',
            setMode(mode) {
              const session = sessionRepository.get(sessionId)
              if (session) {
                sessionRepository.update({
                  ...session,
                  permissionMode: mode,
                  updatedAt: Date.now(),
                })
              }
            },
            onModeChanged(mode, source) {
              const win = options.getWindow()
              if (!win || win.isDestroyed()) return
              win.webContents.send(IPC.AGENT_STREAM, {
                sessionId,
                runId: 0,
                payload: {
                  channel: 'host',
                  event: { type: 'mode_changed', mode, source },
                },
              })
            },
            requestApproval: (plan, signal) =>
              planAskBroker.requestApproval({ sessionId, plan }, signal),
          }))
          if (enabled.has('ask_user')) {
            tools.push(buildAskUserTool({
              requestAnswers: (questions, signal) =>
                askUserBroker.requestAnswers({ sessionId, questions }, signal),
            }))
          }
          // C08：技能加载是宿主只读能力，不参与工具三档设置（技能从工具区移除）；
          // 启用的技能清单来自 Run 启动时冻结的 invocation.skills。
          tools.push(
            buildSkillTool({
              skills: invocation.skills ?? [],
              loader: skillLoader,
            }),
          )
          // C11：已连接 MCP 的 server.method 工具进入本次 Run 的工具集。
          for (const descriptor of frozen) {
            if (descriptor.category !== 'mcp') continue
            const owner = descriptor.owner
            if (!owner) continue
            const method = descriptor.name.slice(
              descriptor.name.indexOf('.') + 1,
            )
            tools.push(
              buildMcpTool({
                toolId: descriptor.id,
                method,
                label: descriptor.label,
                description: descriptor.description,
                expectedIdentity: mcp.identity(owner, method),
                assertIdentity: (expected) =>
                  invocationIdentityBinder.assert(expected, mcp.identity(owner, method)),
                call: (args, signal) =>
                  mcp.call(owner, method, args, signal),
              }),
            )
          }
          return tools
        },
        toolPolicy: createPolicyEngine({
          rules: permissionRules,
          getMode: (sessionId) =>
            sessionRepository.get(sessionId)?.permissionMode ?? 'auto',
          getWorkspaceId: (sessionId) =>
            sessionRepository.get(sessionId)?.workspaceId,
          ask: (input, signal) => permissionAskBroker.ask(input, signal),
          normalizer: invocationNormalizer,
          classifier: riskClassifier,
          ruleIndex: permissionRuleIndex,
          planEffects,
        }),
      }),
      contextCompactor: createPiContextCompactor(),
      history: messageHistory,
      sessions: createSessionCommands({
        repository: sessionRepository,
        history: messageHistory,
        createId,
        now: Date.now,
        resolveCwd: () => process.cwd(),
        workspaceId: () => workspaceService.current()?.id,
        onHistoryDeleteError(sessionId, error) {
          console.error(`[application] Session ${sessionId} 消息清理失败`, error)
        },
      }),
      sessionTitles,
      workspaces: workspaceService,
      permissions: permissionAskBroker,
      plans: planAskBroker,
      questions: askUserBroker,
      rules: permissionRules,
      artifacts: artifactRepository,
      blobCleanup,
      secretStore,
      channels,
      providerCatalog: createPiProviderCatalog(),
      profiles,
      skills,
      mcp,
      runs,
      delegationRef,
      createRunId: createId,
      toolRegistry,
      dispose: () => createdMessageStore.dispose(),
    })
    // A02：附件 IO 由 Composition Root 注入，IPC 层不 import Runtime 内部 store
    const attachmentIo: AttachmentIo = {
      async stage(input) {
        const blob = await blobStore.put(input.bytes, {
          ...(input.mime ? { mime: input.mime } : {}),
        })
        return {
          id: randomUUID(),
          name: input.name,
          size: input.bytes.byteLength,
          ...(input.mime ? { mime: input.mime } : {}),
          blob,
        }
      },
      discard: (ref) => blobStore.delete(ref.blob.hash),
      async readToolOutput(ref) {
        const bytes = await blobStore.get(ref)
        return new TextDecoder().decode(bytes)
      },
    }
    // A07：Artifact 只读预览 + 外部打开（路径逃逸双防线在 artifact-io 内）
    const artifactIo: ArtifactIo = createArtifactIo({
      artifacts: artifactRepository,
      workspaces: workspaceService,
      openPath: (path) => shell.openPath(path),
    })
    unsubscribe = registerIpc(
      agentRuntime,
      options.getWindow,
      attachmentIo,
      artifactIo,
    )
  } catch (error) {
    void messageStore?.dispose().catch((disposeError: unknown) => {
      console.error('[application] PiSessionStore 初始化回滚失败', disposeError)
    })
    appDatabase.close()
    throw error
  }
  let disposed = false

  return {
    agentRuntime,
    migration,
    recovery,
    async dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      try {
        await agentRuntime.dispose()
      } finally {
        appDatabase.close()
      }
    },
  }
}

/**
 * 把旧 `channels.json`（或环境变量兜底渠道）一次性迁入 SQLite：
 * apiKey 经 SecretStore 落成 ref，SQLite 只存引用；迁移后改名旧文件，
 * 避免下次启动重复导入（导入本身也按 id 幂等）。
 */
function migrateLegacyChannels(
  channels: ReturnType<typeof createChannelService>,
  channelRepository: SqliteChannelRepository,
): void {
  const legacy = readLegacyChannels()
  if (legacy.length === 0) return
  for (const channel of legacy) {
    if (channelRepository.get(channel.id)) continue
    try {
      channels.save(channel)
    } catch (error) {
      // 单条渠道迁移失败（如密钥解密/加密不可用）不阻塞应用启动，
      // 该渠道可后续在设置页重新配置。
      console.error(`[channel] legacy 渠道迁移失败，跳过：${channel.id}`, error)
    }
  }
  markLegacyChannelsMigrated()
}

function reportInterruptedRunRecovery(
  report: InterruptedRunRecoveryReport,
): void {
  if (report.recovered.length > 0) {
    console.warn(
      `[recovery] 已把 ${report.recovered.length} 个遗留运行标记为 interrupted`,
    )
  }
  for (const failure of report.failures) {
    console.warn(
      `[recovery] Session ${failure.sessionId} ${failure.stage} 恢复失败：${failure.message}`,
    )
  }
}

function reportLegacyMigration(report: LegacyMigrationReport): void {
  if (!report.found) return
  console.info(
    `[migration] legacy sessions：${report.outcomes.length} 个完成，`
    + `${report.diagnostics.length} 条行诊断，${report.failures.length} 个失败`,
  )
  for (const diagnostic of report.diagnostics) {
    console.warn(
      `[migration] ${diagnostic.relativePath}:${diagnostic.line} `
      + `[${diagnostic.code}] ${diagnostic.reason}`,
    )
  }
  for (const failure of report.failures) {
    console.warn(
      `[migration] ${failure.relativePath}:${failure.line} [${failure.code}]${
        failure.sessionId ? ` (${failure.sessionId})` : ''
      }：${failure.reason}`,
    )
  }
}
