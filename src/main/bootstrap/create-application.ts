import type { BrowserWindow } from 'electron'
import {
  basename,
  resolve,
} from 'node:path'
import {
  createPermissionAskBroker,
  createPolicyEngine,
  createSessionCommands,
  createSessionMessageHistory,
  createWorkspaceService,
  recoverInterruptedRuns,
  type AgentRuntime,
  type InterruptedRunRecoveryReport,
} from '../../runtime/index.ts'
import {
  AppDatabase,
  SqlitePermissionRuleRepository,
  SqliteSessionRepository,
  SqliteWorkspaceRepository,
} from '../../infrastructure/sqlite/index.ts'
import { NodeWorkspaceMountResolver } from '../../infrastructure/workspace/index.ts'
import {
  createPiAgentEngine,
  createPiContextCompactor,
  createPiSessionStore,
  PiRunExecutionEnvFactory,
} from '../../kernel/pi/index.ts'
import { registerIpc } from '../ipc.ts'
import * as permission from '../permission-service.ts'
import { buildBuiltinTools } from '../tools/index.ts'
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
    workspaceService.ensureDefault(process.cwd())
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
        tools: (invocation, env) => buildBuiltinTools(invocation.cwd, env),
        toolPolicy: createPolicyEngine({
          rules: permissionRules,
          getMode: (sessionId) => permission.getMode(sessionId),
          getWorkspaceId: (sessionId) =>
            sessionRepository.get(sessionId)?.workspaceId,
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
      rules: permissionRules,
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
