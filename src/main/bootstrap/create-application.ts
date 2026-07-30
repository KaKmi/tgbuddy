import type { BrowserWindow } from 'electron'
import type { TgBuddyRuntime } from '../../runtime/index.ts'
import { registerIpc } from '../ipc.ts'
import { createLegacyRuntime } from './create-legacy-runtime.ts'

export interface CreateApplicationOptions {
  getWindow(): BrowserWindow | null
}

export interface TgBuddyApplication {
  runtime: TgBuddyRuntime
  dispose(): Promise<void>
}

/**
 * Electron 唯一 Composition Root。后续 Story 只替换这里的 adapter 装配。
 */
export function createApplication(options: CreateApplicationOptions): TgBuddyApplication {
  const runtime = createLegacyRuntime()
  const unsubscribe = registerIpc(runtime, options.getWindow)
  let disposed = false

  return {
    runtime,
    async dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      await runtime.dispose()
    },
  }
}
