import type { Channel } from '../../shared/contracts/channel.ts'
import type { ContextUsage } from '../../shared/contracts/context.ts'
import type {
  AgentEvent,
  StreamFrame,
} from '../../shared/contracts/events.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type {
  SessionMessageHistory,
} from '../sessions/session-message-history.ts'
import type {
  ContextCompactor,
  PreparedContextCompaction,
} from './ports/context-compactor.ts'

type FrameSender = (frame: StreamFrame) => void
type TurnUsage = NonNullable<Extract<AgentEvent, { type: 'turn_end' }>['usage']>

export const CONTEXT_AUTO_COMPACTION_THRESHOLD = 0.85
export const CONTEXT_AUTO_COMPACTION_DELAY_MS = 3_000
const CONTEXT_DEFERRED_RESCHEDULE_GAP = 0.05

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

export interface ContextClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(timer: unknown): void
}

export interface CreateContextServiceOptions {
  sessions: ContextSessionCatalog
  history: SessionMessageHistory
  channels: ContextChannelCatalog
  compactor: ContextCompactor
  clock?: ContextClock
}

export interface ObserveContextTurnInput {
  sessionId: string
  usage: TurnUsage
  contextWindow: number
  emit: FrameSender
  isRunning(): boolean
}

export interface BeforeModelCallInput {
  sessionId: string
  contextTokens: number
  contextWindow: number
  emit: FrameSender
}

interface ActiveCompaction {
  controller: AbortController
}

interface ScheduledCompaction {
  timer: unknown
  usedTokens: number
}

interface QueuedCompaction {
  emit: FrameSender
}

export interface ContextService {
  start(
    sessionId: string,
    emit: FrameSender,
    isRunning?: () => boolean,
  ): Promise<void>
  observeTurn(input: ObserveContextTurnInput): void
  beforeModelCall(input: BeforeModelCallInput): Promise<boolean>
  runSettled(sessionId: string): void
  defer(sessionId: string, emit: FrameSender): void
  cancel(sessionId: string, emit: FrameSender): boolean
  clearSession(sessionId: string): void
  isCompacting(sessionId: string): boolean
  dispose(): void
}

/**
 * Runtime 统一编排手动与自动压缩：pi 只负责估算和生成摘要，计时、排队及持久化
 * 都留在应用内核，避免 Main 和 Renderer 各维护一套竞态状态。
 */
export function createContextService(
  options: CreateContextServiceOptions,
): ContextService {
  const clock = options.clock ?? systemClock()
  const active = new Map<string, ActiveCompaction>()
  const scheduled = new Map<string, ScheduledCompaction>()
  const queued = new Map<string, QueuedCompaction>()
  const deferredAt = new Map<string, number>()
  let disposed = false

  const clearScheduled = (sessionId: string): ScheduledCompaction | undefined => {
    const item = scheduled.get(sessionId)
    if (item) clock.clearTimeout(item.timer)
    scheduled.delete(sessionId)
    return item
  }

  const compact = async (
    sessionId: string,
    emit: FrameSender,
  ): Promise<boolean> => {
    if (disposed || active.has(sessionId)) return false
    clearScheduled(sessionId)
    queued.delete(sessionId)

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
      return false
    }

    const controller = new AbortController()
    active.set(sessionId, { controller })
    emitHost(emit, sessionId, {
      type: 'compaction_start',
      compactedCount: prepared.compactedCount,
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
      deferredAt.delete(sessionId)

      // UI 收到完成事件后会立即发送排队消息，所以必须先释放压缩锁。
      active.delete(sessionId)
      emitHost(emit, sessionId, {
        type: 'compaction_end',
        summary: marker.summary,
        compactedCount: marker.compactedCount,
        usage,
      })
      return true
    } catch (error) {
      active.delete(sessionId)
      emitHost(emit, sessionId, { type: 'compaction_cancelled' })
      if (!controller.signal.aborted) {
        emitHost(emit, sessionId, {
          type: 'host_error',
          message: `压缩失败：${errorMessage(error)}`,
          recoverable: true,
        })
      }
      return false
    } finally {
      active.delete(sessionId)
    }
  }

  const service: ContextService = {
    async start(sessionId, emit, isRunning = () => false) {
      if (disposed) return
      clearScheduled(sessionId)
      if (active.has(sessionId)) return
      if (isRunning()) {
        queued.set(sessionId, { emit })
        emitHost(emit, sessionId, { type: 'compaction_queued' })
        return
      }
      await compact(sessionId, emit)
    },

    observeTurn(input) {
      if (disposed) return
      const session = options.sessions.list().find(
        (item) => item.id === input.sessionId,
      )
      if (!session) return

      const contextUsage = buildObservedContextUsage(
        input.usage,
        input.contextWindow,
        session.contextUsage,
        clock.now(),
      )
      options.sessions.updateMeta(input.sessionId, { contextUsage })
      emitHost(input.emit, input.sessionId, {
        type: 'context_usage',
        usage: contextUsage,
      })

      if (
        active.has(input.sessionId)
        || scheduled.has(input.sessionId)
        || queued.has(input.sessionId)
        || !shouldSchedule(
          contextUsage.usedTokens,
          contextUsage.contextWindow,
          deferredAt.get(input.sessionId),
        )
      ) {
        return
      }

      const deadlineAt = clock.now() + CONTEXT_AUTO_COMPACTION_DELAY_MS
      const timer = clock.setTimeout(() => {
        scheduled.delete(input.sessionId)
        if (input.isRunning()) {
          queued.set(input.sessionId, { emit: input.emit })
          emitHost(input.emit, input.sessionId, { type: 'compaction_queued' })
          return
        }
        void compact(input.sessionId, input.emit)
      }, CONTEXT_AUTO_COMPACTION_DELAY_MS)
      scheduled.set(input.sessionId, {
        timer,
        usedTokens: contextUsage.usedTokens,
      })
      emitHost(input.emit, input.sessionId, {
        type: 'compaction_scheduled',
        deadlineAt,
      })
    },

    async beforeModelCall(input) {
      if (disposed) return false
      if (
        !shouldSchedule(
          input.contextTokens,
          input.contextWindow,
          deferredAt.get(input.sessionId),
        )
      ) {
        return false
      }
      return compact(input.sessionId, input.emit)
    },

    runSettled(sessionId) {
      if (disposed) return
      const item = queued.get(sessionId)
      if (!item) return
      queued.delete(sessionId)
      void compact(sessionId, item.emit)
    },

    defer(sessionId, emit) {
      const item = clearScheduled(sessionId)
      if (!item) return
      deferredAt.set(sessionId, item.usedTokens)
      emitHost(emit, sessionId, { type: 'compaction_cancelled' })
    },

    cancel(sessionId, emit) {
      const pending = clearScheduled(sessionId)
      const wasQueued = queued.delete(sessionId)
      const running = active.get(sessionId)
      running?.controller.abort()
      if (!running && (pending || wasQueued)) {
        emitHost(emit, sessionId, { type: 'compaction_cancelled' })
      }
      return running !== undefined || pending !== undefined || wasQueued
    },

    clearSession(sessionId) {
      clearScheduled(sessionId)
      queued.delete(sessionId)
      deferredAt.delete(sessionId)
      active.get(sessionId)?.controller.abort()
      active.delete(sessionId)
    },

    isCompacting(sessionId) {
      return active.has(sessionId)
    },

    dispose() {
      if (disposed) return
      disposed = true
      const sessionIds = new Set([
        ...active.keys(),
        ...scheduled.keys(),
        ...queued.keys(),
        ...deferredAt.keys(),
      ])
      for (const sessionId of sessionIds) service.clearSession(sessionId)
    },
  }

  return service
}

export function shouldSchedule(
  usedTokens: number,
  contextWindow: number,
  deferredAtTokens?: number,
): boolean {
  if (
    contextWindow <= 0
    || usedTokens < contextWindow * CONTEXT_AUTO_COMPACTION_THRESHOLD
  ) {
    return false
  }
  if (deferredAtTokens === undefined) return true
  return (
    usedTokens
    >= deferredAtTokens + contextWindow * CONTEXT_DEFERRED_RESCHEDULE_GAP
  )
}

function buildObservedContextUsage(
  usage: TurnUsage,
  contextWindow: number,
  previous: ContextUsage | undefined,
  now: number,
): ContextUsage {
  const usedTokens = Math.max(0, usage.totalTokens)
  const stable = previous?.breakdown ?? {
    systemPrompt: 0,
    tools: 0,
    messages: 0,
    skills: 0,
    mcp: 0,
  }
  const fixed = stable.systemPrompt + stable.tools + stable.skills + stable.mcp

  return {
    usedTokens,
    contextWindow: Math.max(0, contextWindow),
    percent:
      contextWindow > 0
        ? Math.round((usedTokens / contextWindow) * 1_000) / 10
        : 0,
    breakdown: {
      ...stable,
      messages: Math.max(0, usedTokens - fixed),
    },
    outputTokens: usage.output,
    costUsd: usage.cost.total,
    updatedAt: now,
  }
}

function emitHost(
  emit: FrameSender,
  sessionId: string,
  event: Extract<StreamFrame['payload'], { channel: 'host' }>['event'],
): void {
  emit({
    sessionId,
    runId: 0,
    payload: { channel: 'host', event },
  })
}

function emitFailure(
  emit: FrameSender,
  sessionId: string,
  error: unknown,
): void {
  emitHost(emit, sessionId, { type: 'compaction_cancelled' })
  emitHost(emit, sessionId, {
    type: 'host_error',
    message: errorMessage(error),
    recoverable: true,
  })
}

function systemClock(): ContextClock {
  return {
    now: Date.now,
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
