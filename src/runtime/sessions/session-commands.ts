import type { SessionCommands } from '../app/tgbuddy-runtime.ts'
import type { SessionMessage } from '../../shared/contracts/message.ts'
import type { SessionRepository } from './session-repository.ts'

export interface SessionHistoryAdapter {
  messages(sessionId: string): SessionMessage[]
  compactedMessages(sessionId: string, compactionId: string): SessionMessage[]
  delete(sessionId: string): void
}

export interface CreateSessionCommandsOptions {
  repository: SessionRepository
  history: SessionHistoryAdapter
  createId(): string
  now(): number
}

/**
 * 组合 Session catalog 与消息历史。
 *
 * K03 只替换 catalog，消息历史仍由 legacy JSONL 提供；K05 替换消息后端时，
 * 这里只需换掉 history adapter，不再改 IPC 或 Renderer。
 */
export function createSessionCommands(
  options: CreateSessionCommandsOptions,
): SessionCommands {
  return {
    list: () => options.repository.list(),
    create(input) {
      const now = options.now()
      return options.repository.create({
        id: options.createId(),
        title: input.title ?? '新会话',
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        createdAt: now,
        updatedAt: now,
      })
    },
    delete(sessionId) {
      options.repository.delete(sessionId)
      options.history.delete(sessionId)
    },
    messages: (sessionId) => options.history.messages(sessionId),
    compactedMessages: (sessionId, compactionId) =>
      options.history.compactedMessages(sessionId, compactionId),
    updateMeta(sessionId, patch) {
      const current = options.repository.get(sessionId)
      if (!current) return
      options.repository.update({
        ...current,
        ...patch,
        id: sessionId,
        updatedAt: options.now(),
      })
    },
  }
}
