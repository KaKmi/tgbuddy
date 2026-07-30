import type { SessionCommands } from '../app/tgbuddy-runtime.ts'
import type { SessionMessage } from '../../shared/contracts/message.ts'
import type { SessionRepository } from './session-repository.ts'

export interface SessionHistoryAdapter {
  create(sessionId: string, cwd: string): Promise<void>
  messages(sessionId: string): Promise<SessionMessage[]>
  compactedMessages(sessionId: string, compactionId: string): Promise<SessionMessage[]>
  delete(sessionId: string): Promise<void>
}

export interface CreateSessionCommandsOptions {
  repository: SessionRepository
  history: SessionHistoryAdapter
  createId(): string
  now(): number
  resolveCwd(): string
  onHistoryDeleteError?(sessionId: string, error: unknown): void
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
    async create(input) {
      const now = options.now()
      const meta = options.repository.create({
        id: options.createId(),
        title: input.title ?? '新会话',
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        createdAt: now,
        updatedAt: now,
      })
      try {
        await options.history.create(meta.id, options.resolveCwd())
        return meta
      } catch (error) {
        options.repository.delete(meta.id)
        throw error
      }
    },
    async delete(sessionId) {
      // catalog 是用户可见的 canonical 状态：它删除失败时不得先破坏消息；
      // 消息清理失败则保留为不可见孤儿并上报，不能把已删除会话重新暴露成空历史。
      options.repository.delete(sessionId)
      try {
        await options.history.delete(sessionId)
      } catch (error) {
        options.onHistoryDeleteError?.(sessionId, error)
      }
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
