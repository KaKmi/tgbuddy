import type { Channel } from '../../shared/contracts/channel.ts'
import type { ContextUsage } from '../../shared/contracts/context.ts'
import type { StreamFrame } from '../../shared/contracts/events.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type {
  SessionMessageHistory,
} from '../sessions/session-message-history.ts'
import type {
  ContextCompactor,
  PreparedContextCompaction,
} from './ports/context-compactor.ts'

type FrameSender = (frame: StreamFrame) => void

export interface ContextSessionCatalog {
  list(): SessionMeta[]
  updateMeta(
    sessionId: string,
    patch: Partial<SessionMeta>,
  ): SessionMeta | undefined
}

export interface ContextChannelCatalog {
  list(): Channel[]
}

export interface CreateContextServiceOptions {
  sessions: ContextSessionCatalog
  history: SessionMessageHistory
  channels: ContextChannelCatalog
  compactor: ContextCompactor
}

interface ActiveCompaction {
  controller: AbortController
}

export interface ContextService {
  start(
    sessionId: string,
    emit: FrameSender,
    isRunning?: () => boolean,
  ): Promise<void>
  cancel(sessionId: string, emit: FrameSender): boolean
  clearSession(sessionId: string): void
  isCompacting(sessionId: string): boolean
}

/**
 * 手动压缩由 Runtime 编排：选择会话与模型、持久化摘要、更新用量并发布状态。
 * pi 只通过 ContextCompactor 端口执行摘要，不感知 Runtime 生命周期。
 */
export function createContextService(
  options: CreateContextServiceOptions,
): ContextService {
  const active = new Map<string, ActiveCompaction>()

  const emitHost = (
    emit: FrameSender,
    sessionId: string,
    event: StreamFrame['payload'] & { channel: 'host' },
  ): void => {
    emit({ sessionId, runId: 0, payload: event })
  }

  return {
    async start(sessionId, emit, isRunning = () => false) {
      if (active.has(sessionId)) return
      if (isRunning()) {
        emitHost(emit, sessionId, {
          channel: 'host',
          event: {
            type: 'host_error',
            message: '任务运行中，暂时无法手动压缩上下文',
            recoverable: true,
          },
        })
        return
      }

      let prepared: PreparedContextCompaction
      let previousUsage: ContextUsage | undefined
      try {
        const session = options.sessions.list().find((item) => item.id === sessionId)
        if (!session) throw new Error(`会话不存在：${sessionId}`)
        const channels = options.channels.list()
        const channel =
          channels.find((item) => item.id === session.channelId)
          ?? channels[0]
        if (!channel) throw new Error('还没有配置任何渠道')
        const modelId = session.modelId ?? channel.models[0]?.id
        if (!modelId) throw new Error(`渠道「${channel.name}」下没有可用模型`)
        previousUsage = session.contextUsage
        prepared = options.compactor.prepare({
          channel,
          modelId,
          entries: await options.history.compactionSourceEntries(sessionId),
        })
      } catch (error) {
        emitFailure(emit, sessionId, error)
        return
      }

      const controller = new AbortController()
      active.set(sessionId, { controller })
      emitHost(emit, sessionId, {
        channel: 'host',
        event: {
          type: 'compaction_start',
          compactedCount: prepared.compactedCount,
        },
      })

      try {
        const result = await prepared.execute(controller.signal)
        if (
          controller.signal.aborted
          || active.get(sessionId)?.controller !== controller
        ) {
          throw new Error('压缩已取消')
        }

        const marker = await options.history.appendCompaction(sessionId, {
          summary: result.summary,
          firstKeptEntryId: result.firstKeptEntryId,
          tokensBefore: result.tokensBefore,
        })
        const usage = options.compactor.estimateUsage({
          messages: await options.history.messages(sessionId),
          previous: previousUsage,
          contextWindow: prepared.contextWindow,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        })
        options.sessions.updateMeta(sessionId, { contextUsage: usage })

        // 完成事件可能立即触发下一条用户操作，必须先释放占用状态。
        active.delete(sessionId)
        emitHost(emit, sessionId, {
          channel: 'host',
          event: {
            type: 'compaction_end',
            summary: marker.summary,
            compactedCount: marker.compactedCount,
            usage,
          },
        })
      } catch (error) {
        active.delete(sessionId)
        emitHost(emit, sessionId, {
          channel: 'host',
          event: { type: 'compaction_cancelled' },
        })
        if (!controller.signal.aborted) {
          emitHost(emit, sessionId, {
            channel: 'host',
            event: {
              type: 'host_error',
              message: `压缩失败：${errorMessage(error)}`,
              recoverable: true,
            },
          })
        }
      } finally {
        active.delete(sessionId)
      }
    },

    cancel(sessionId, emit) {
      const item = active.get(sessionId)
      item?.controller.abort()
      return item !== undefined
    },

    clearSession(sessionId) {
      active.get(sessionId)?.controller.abort()
      active.delete(sessionId)
    },

    isCompacting(sessionId) {
      return active.has(sessionId)
    },
  }
}

function emitFailure(
  emit: FrameSender,
  sessionId: string,
  error: unknown,
): void {
  emit({
    sessionId,
    runId: 0,
    payload: {
      channel: 'host',
      event: { type: 'compaction_cancelled' },
    },
  })
  emit({
    sessionId,
    runId: 0,
    payload: {
      channel: 'host',
      event: {
        type: 'host_error',
        message: errorMessage(error),
        recoverable: true,
      },
    },
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
