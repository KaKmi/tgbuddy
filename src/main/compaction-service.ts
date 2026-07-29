/**
 * 上下文压缩编排。
 *
 * 自动触发先给 3 秒「稍后」窗口；真正压缩时独占会话，运行中的任务只排队，
 * 不在 Agent loop 中途替换它正在使用的消息数组。
 */

import {
  compactPreparedContext,
  prepareCompactionRuntime,
  shouldScheduleCompaction,
  type CompactionKernelRuntime,
} from '../kernel/compaction.ts'
import { buildPostCompactionUsage } from '../kernel/context-usage.ts'
import { toKernelMessages } from '../shared/types/message.ts'
import type { HostEvent, StreamFrame } from '../shared/types/event.ts'
import { listChannels } from './channel-store.ts'
import * as store from './session-store.ts'

type FrameSender = (frame: StreamFrame) => void

const AUTO_DELAY_MS = 3_000

interface RunningCompaction {
  controller: AbortController
}

interface ScheduledCompaction {
  timer: ReturnType<typeof setTimeout>
  usedTokens: number
}

const running = new Map<string, RunningCompaction>()
const scheduled = new Map<string, ScheduledCompaction>()
const queued = new Set<string>()
const deferredAt = new Map<string, number>()

function emitHost(
  sendFrame: FrameSender,
  sessionId: string,
  event: HostEvent,
): void {
  sendFrame({ sessionId, runId: 0, payload: { channel: 'host', event } })
}

function resolveRuntime(sessionId: string): CompactionKernelRuntime {
  const meta = store.getSession(sessionId)
  if (!meta) throw new Error(`会话不存在：${sessionId}`)
  const channels = listChannels()
  const channel = channels.find((item) => item.id === meta.channelId) ?? channels[0]
  if (!channel) throw new Error('还没有配置任何渠道')
  const modelId = meta.modelId ?? channel.models[0]?.id
  if (!modelId) throw new Error(`渠道「${channel.name}」下没有可用模型`)
  const runtime = prepareCompactionRuntime(
    channels,
    channel.id,
    modelId,
    store.getCompactionSourceEntries(sessionId),
  )
  if (!runtime.ok) throw runtime.error
  return runtime.value
}

export function scheduleIfNeeded(
  sessionId: string,
  usedTokens: number,
  contextWindow: number,
  sendFrame: FrameSender,
  isSessionRunning: () => boolean,
): void {
  if (
    scheduled.has(sessionId) ||
    running.has(sessionId) ||
    !shouldScheduleCompaction(usedTokens, contextWindow, deferredAt.get(sessionId))
  ) {
    return
  }

  const deadlineAt = Date.now() + AUTO_DELAY_MS
  const timer = setTimeout(() => {
    scheduled.delete(sessionId)
    void start(sessionId, sendFrame, isSessionRunning)
  }, AUTO_DELAY_MS)
  scheduled.set(sessionId, { timer, usedTokens })
  emitHost(sendFrame, sessionId, { type: 'compaction_scheduled', deadlineAt })
}

export function isCompacting(sessionId: string): boolean {
  return running.has(sessionId)
}

export function defer(sessionId: string, sendFrame: FrameSender): void {
  const item = scheduled.get(sessionId)
  if (!item) return
  clearTimeout(item.timer)
  scheduled.delete(sessionId)
  deferredAt.set(sessionId, item.usedTokens)
  emitHost(sendFrame, sessionId, { type: 'compaction_cancelled' })
}

export async function start(
  sessionId: string,
  sendFrame: FrameSender,
  isSessionRunning: () => boolean = () => false,
): Promise<void> {
  const pending = scheduled.get(sessionId)
  if (pending) {
    clearTimeout(pending.timer)
    scheduled.delete(sessionId)
  }
  if (running.has(sessionId)) return
  if (isSessionRunning()) {
    queued.add(sessionId)
    emitHost(sendFrame, sessionId, { type: 'compaction_queued' })
    return
  }

  let runtime: CompactionKernelRuntime
  try {
    runtime = resolveRuntime(sessionId)
  } catch (error) {
    emitHost(sendFrame, sessionId, { type: 'compaction_cancelled' })
    emitHost(sendFrame, sessionId, {
      type: 'host_error',
      message: error instanceof Error ? error.message : String(error),
      recoverable: true,
    })
    return
  }

  const controller = new AbortController()
  running.set(sessionId, { controller })
  emitHost(sendFrame, sessionId, {
    type: 'compaction_start',
    compactedCount:
      runtime.preparation.messagesToSummarize.length +
      runtime.preparation.turnPrefixMessages.length,
  })

  try {
    const result = await compactPreparedContext(
      runtime.preparation,
      runtime.models,
      runtime.model,
      controller.signal,
    )
    if (!result.ok) throw result.error
    if (controller.signal.aborted || running.get(sessionId)?.controller !== controller) {
      throw new Error('压缩已取消')
    }
    const marker = store.appendCompaction(sessionId, result.value)
    const meta = store.getSession(sessionId)
    const contextUsage = buildPostCompactionUsage(
      toKernelMessages(store.getMessages(sessionId)),
      meta?.contextUsage,
      runtime.model.contextWindow,
      result.value.usage?.output,
      result.value.usage?.cost.total,
    )
    store.updateMeta(sessionId, { contextUsage })
    deferredAt.delete(sessionId)
    // 先释放锁再通知 UI；否则 UI 收到完成事件后立即发送排队消息，会被 isCompacting 拒绝。
    running.delete(sessionId)
    emitHost(sendFrame, sessionId, {
      type: 'compaction_end',
      summary: marker.summary,
      compactedCount: marker.compactedCount,
      usage: contextUsage,
    })
  } catch (error) {
    running.delete(sessionId)
    if (controller.signal.aborted) {
      emitHost(sendFrame, sessionId, { type: 'compaction_cancelled' })
    } else {
      emitHost(sendFrame, sessionId, { type: 'compaction_cancelled' })
      emitHost(sendFrame, sessionId, {
        type: 'host_error',
        message: `压缩失败：${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      })
    }
  } finally {
    running.delete(sessionId)
  }
}

export function cancel(sessionId: string, sendFrame: FrameSender): void {
  const pending = scheduled.get(sessionId)
  if (pending) clearTimeout(pending.timer)
  scheduled.delete(sessionId)
  queued.delete(sessionId)
  running.get(sessionId)?.controller.abort()
  if (!running.has(sessionId)) {
    emitHost(sendFrame, sessionId, { type: 'compaction_cancelled' })
  }
}

export function runQueued(sessionId: string, sendFrame: FrameSender): void {
  if (!queued.delete(sessionId)) return
  void start(sessionId, sendFrame)
}

export function clearSession(sessionId: string): void {
  const pending = scheduled.get(sessionId)
  if (pending) clearTimeout(pending.timer)
  scheduled.delete(sessionId)
  queued.delete(sessionId)
  deferredAt.delete(sessionId)
  running.get(sessionId)?.controller.abort()
  running.delete(sessionId)
}
