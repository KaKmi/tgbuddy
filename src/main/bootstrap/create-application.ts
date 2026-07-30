import type { BrowserWindow } from 'electron'
import {
  createSessionCommands,
  createSessionMessageHistory,
  type TgBuddyRuntime,
} from '../../runtime/index.ts'
import {
  AppDatabase,
  SqliteSessionRepository,
} from '../../infrastructure/sqlite/index.ts'
import {
  createPiAgentEngine,
  createPiSessionStore,
} from '../../kernel/pi/index.ts'
import { registerIpc } from '../ipc.ts'
import * as store from '../session-store.ts'
import { createLegacyRuntime } from './create-legacy-runtime.ts'
import {
  importLegacySessions,
  type LegacyMigrationReport,
} from './import-legacy-sessions.ts'

export interface CreateApplicationOptions {
  getWindow(): BrowserWindow | null
  databasePath: string
  legacyDataDir: string
}

export interface TgBuddyApplication {
  runtime: TgBuddyRuntime
  migration: LegacyMigrationReport
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

  let messageStore: ReturnType<typeof createPiSessionStore> | undefined
  let runtime: TgBuddyRuntime
  let unsubscribe: () => void
  let migration: LegacyMigrationReport
  try {
    migration = await importLegacySessions({
      legacyDataDir: options.legacyDataDir,
      databasePath: options.databasePath,
      repository: sessionRepository,
    })
    reportLegacyMigration(migration)
    const createdMessageStore = createPiSessionStore({
      databasePath: options.databasePath,
      cwd: process.cwd(),
    })
    messageStore = createdMessageStore
    const messageHistory = createSessionMessageHistory({
      store: createdMessageStore,
      createId: store.newId,
      now: Date.now,
    })
    store.configureSessionRepository(sessionRepository)
    runtime = createLegacyRuntime({
      agentEngine: createPiAgentEngine({
        sessions: createdMessageStore,
      }),
      history: messageHistory,
      sessions: createSessionCommands({
        repository: sessionRepository,
        history: messageHistory,
        createId: store.newId,
        now: Date.now,
        resolveCwd: () => process.cwd(),
        onHistoryDeleteError(sessionId, error) {
          console.error(`[application] Session ${sessionId} 消息清理失败`, error)
        },
      }),
      dispose: () => createdMessageStore.dispose(),
    })
    unsubscribe = registerIpc(runtime, options.getWindow)
  } catch (error) {
    store.configureSessionRepository(undefined)
    void messageStore?.dispose().catch((disposeError: unknown) => {
      console.error('[application] PiSessionStore 初始化回滚失败', disposeError)
    })
    appDatabase.close()
    throw error
  }
  let disposed = false

  return {
    runtime,
    migration,
    async dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      try {
        await runtime.dispose()
      } finally {
        store.configureSessionRepository(undefined)
        appDatabase.close()
      }
    },
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
