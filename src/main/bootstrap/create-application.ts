import type { BrowserWindow } from 'electron'
import {
  createSessionCommands,
  type TgBuddyRuntime,
} from '../../runtime/index.ts'
import {
  AppDatabase,
  SqliteSessionRepository,
} from '../../infrastructure/sqlite/index.ts'
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
  store.configureSessionRepository(sessionRepository)

  let runtime: TgBuddyRuntime
  let unsubscribe: () => void
  try {
    runtime = createLegacyRuntime({
      sessions: createSessionCommands({
        repository: sessionRepository,
        history: {
          messages: store.getMessages,
          compactedMessages: store.getCompactedMessages,
          delete: store.deleteSessionMessages,
        },
        createId: store.newId,
        now: Date.now,
      }),
    })
    unsubscribe = registerIpc(runtime, options.getWindow)
  } catch (error) {
    store.configureSessionRepository(undefined)
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
