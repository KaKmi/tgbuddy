/**
 * Compatibility adapter：把现有 Main service/store 委托给 Runtime 门面。
 *
 * 删除期限：
 * - Session/channel 存储委托在 Story 1B 切换 SQLite 时删除。
 * - orchestrator、permission、plan、question、compaction 委托在 Story 1C 删除。
 * - 该文件不得成为第二个长期应用门面。
 */
import { createTgBuddyRuntime, type TgBuddyRuntime } from '../../runtime/index.ts'
import * as askUser from '../ask-user-service.ts'
import { ensureDataDir, listChannels, saveChannels } from '../channel-store.ts'
import * as compaction from '../compaction-service.ts'
import * as orchestrator from '../orchestrator.ts'
import * as permission from '../permission-service.ts'
import * as plan from '../plan-service.ts'
import * as store from '../session-store.ts'

export function createLegacyRuntime(): TgBuddyRuntime {
  ensureDataDir()

  return createTgBuddyRuntime({
    workspaces: {
      list: () => [],
    },
    sessions: {
      list: store.listSessions,
      create: store.createSession,
      delete: store.deleteSession,
      messages: store.getMessages,
      compactedMessages: store.getCompactedMessages,
      updateMeta: store.updateMeta,
    },
    runs: {
      send: orchestrator.send,
      stop: orchestrator.stop,
      isRunning: orchestrator.isRunning,
    },
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
      start: compaction.start,
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
  })
}
