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
import { createPiSessionStore } from '../../kernel/pi/index.ts'
import { registerIpc } from '../ipc.ts'
import * as store from '../session-store.ts'
import { createLegacyRuntime } from './create-legacy-runtime.ts'

export interface CreateApplicationOptions {
  getWindow(): BrowserWindow | null
  databasePath: string
}

export interface TgBuddyApplication {
  runtime: TgBuddyRuntime
  dispose(): Promise<void>
}

/**
 * Electron 唯一 Composition Root。后续 Story 只替换这里的 adapter 装配。
 */
export function createApplication(options: CreateApplicationOptions): TgBuddyApplication {
  const appDatabase = AppDatabase.open(options.databasePath)
  const sessionRepository = new SqliteSessionRepository(appDatabase)

  let messageStore: ReturnType<typeof createPiSessionStore> | undefined
  let runtime: TgBuddyRuntime
  let unsubscribe: () => void
  try {
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
