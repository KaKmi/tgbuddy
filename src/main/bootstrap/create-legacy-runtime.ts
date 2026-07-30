/**
 * Compatibility adapter：把现有 Main service/store 委托给 Runtime 门面。
 *
 * 删除期限：
 * - Session catalog 已在 K03 改为注入；legacy 消息委托在 K05 删除。
 * - orchestrator、permission、plan、question、compaction 委托按 M1 后续 Slice 删除。
 * - 该文件不得成为第二个长期应用门面。
 */
import {
  createRunCoordinator,
  createTgBuddyRuntime,
  type SessionCommands,
  type SessionMessageHistory,
  type TgBuddyRuntime,
} from '../../runtime/index.ts'
import * as askUser from '../ask-user-service.ts'
import { ensureDataDir, listChannels, saveChannels } from '../channel-store.ts'
import * as compaction from '../compaction-service.ts'
import * as orchestrator from '../orchestrator.ts'
import * as permission from '../permission-service.ts'
import * as plan from '../plan-service.ts'

export interface CreateLegacyRuntimeOptions {
  sessions: SessionCommands
  history: SessionMessageHistory
  dispose?(): Promise<void>
}

export function createLegacyRuntime(
  options: CreateLegacyRuntimeOptions,
): TgBuddyRuntime {
  ensureDataDir()
  const runs = createRunCoordinator({
    now: Date.now,
    executor: {
      execute: (input, context) =>
        orchestrator.execute(input, context, options.history),
      stop: orchestrator.stop,
    },
  })

  return createTgBuddyRuntime({
    workspaces: {
      list: () => [],
    },
    sessions: options.sessions,
    runs,
    permissions: {
      respond: permission.respond,
      pending: permission.getPending,
      expireSessionRules: permission.expireSessionRules,
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
      start: (sessionId, emit, isRunning) =>
        compaction.start(sessionId, emit, options.history, isRunning),
      defer: compaction.defer,
      cancel: compaction.cancel,
      clearSession: compaction.clearSession,
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
      await runs.dispose()
      await options.dispose?.()
    },
  })
}
