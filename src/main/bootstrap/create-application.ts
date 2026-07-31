import { safeStorage, shell, type BrowserWindow } from 'electron'
import type { AgentTool } from '@earendil-works/pi-agent-core'
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
  createMcpManager,
  createPlanAskBroker,
  createPermissionAskBroker,
  createPolicyEngine,
  createProfileService,
  createSessionCommands,
  createSessionMessageHistory,
  createToolSettingsService,
  createWorkspaceService,
  recoverInterruptedRuns,
  type AgentRuntime,
  type InterruptedRunRecoveryReport,
} from '../../runtime/index.ts'
import {
  AppDatabase,
  SqliteChannelRepository,
  SqliteMcpConfigRepository,
  SqlitePermissionRuleRepository,
  SqliteProfileRepository,
  SqliteRunRepository,
  SqliteSessionRepository,
  SqliteToolSettingsRepository,
  SqliteWorkspaceRepository,
} from '../../infrastructure/sqlite/index.ts'
import { EncryptedFileSecretStore } from '../../infrastructure/secrets/index.ts'
import { SdkMcpTransportFactory } from '../../infrastructure/mcp/index.ts'
import {
  createFsSkillCatalog,
  createFsSkillLoader,
} from '../../infrastructure/skills/index.ts'
import { NodeWorkspaceMountResolver } from '../../infrastructure/workspace/index.ts'
import {
  buildAskUserTool,
  buildBuiltinTools,
  buildMcpTool,
  buildPlanModeTools,
  buildSkillTool,
  createPiAgentEngine,
  createPiContextCompactor,
  createPiProviderCatalog,
  createPiSessionStore,
  PiRunExecutionEnvFactory,
} from '../../kernel/pi/index.ts'
import { registerIpc } from '../ipc.ts'
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
  const channels = createChannelService({
    repository: channelRepository,
    secrets: secretStore,
    sessions: sessionRepository,
    profiles,
    createId,
  })
  migrateLegacyChannels(channels, channelRepository)
  // C07：技能目录根。内置随应用资源，用户级在数据目录，工作区级随 mount。
  const skills = createFsSkillCatalog({
    builtinRoots: [join(process.cwd(), 'assets', 'skills', 'builtin')],
    userRoots: [join(options.legacyDataDir, 'skills')],
    workspaceRoots: (workspaceId) => {
      const mount = workspaceService.mountStatus(workspaceId)
      return mount.ok ? [join(mount.mount.path, '.tgbuddy', 'skills')] : []
    },
  })
  const skillLoader = createFsSkillLoader()
  // C05：内置工具统一注册，Run 启动按 snapshot 冻结启用集合。
  const toolRegistry = createBuiltinToolRegistry()
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
  // C06：工具三档权限覆盖持久化，PolicyEngine 在规则之下读取。
  const toolSettings = createToolSettingsService({
    registry: toolRegistry,
    repository: new SqliteToolSettingsRepository(appDatabase),
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
    applyGrant(request, grant) {
      permissionRules.add({
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
      })
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
        sessions: createdMessageStore,
        envFactory: new PiRunExecutionEnvFactory(),
        tools: (invocation, env) => {
          const sessionId = invocation.sessionId
          // C12：工具集只来自 Run 启动时冻结的 snapshot，
          // 运行中设置变更（enable/disable/MCP 断开）不影响本次 Run。
          const frozen = invocation.tools ?? toolRegistry.snapshot()
          const enabled = new Set(
            frozen.map((descriptor) => descriptor.name),
          )
          const tools: AgentTool[] = []
          // 基础六工具：只在 snapshot 启用时保留，顺序稳定。
          for (const tool of buildBuiltinTools(invocation.cwd, {
            env,
            trashItem: (absPath) => shell.trashItem(absPath),
          })) {
            if (enabled.has(tool.name)) tools.push(tool)
          }
          if (enabled.has('enter_plan_mode')) {
            // S09：计划模式工具由 kernel/pi adapter 提供，模式本身是 Session 元数据。
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
          }
          if (enabled.has('ask_user')) {
            tools.push(buildAskUserTool({
              requestAnswers: (questions, signal) =>
                askUserBroker.requestAnswers({ sessionId, questions }, signal),
            }))
          }
          if (enabled.has('skill')) {
            // C08：技能正文按需加载，技能清单在 Run 启动时冻结。
            tools.push(
              buildSkillTool({
                skills: invocation.skills ?? [],
                loader: skillLoader,
              }),
            )
          }
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
          getToolPermission: (toolName) => toolSettings.getPermission(toolName),
          ask: (input, signal) => permissionAskBroker.ask(input, signal),
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
      workspaces: workspaceService,
      permissions: permissionAskBroker,
      plans: planAskBroker,
      questions: askUserBroker,
      rules: permissionRules,
      secretStore,
      channels,
      providerCatalog: createPiProviderCatalog(),
      profiles,
      toolSettings,
      skills,
      mcp,
      runs,
      createRunId: createId,
      toolRegistry,
      dispose: () => createdMessageStore.dispose(),
    })
    unsubscribe = registerIpc(agentRuntime, options.getWindow)
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
