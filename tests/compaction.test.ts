import { describe, expect, test } from 'bun:test'
import { convertStoredMessagesToLlm, shouldScheduleCompaction, toPiEntries } from '../src/kernel/compaction.ts'
import { buildPostCompactionUsage } from '../src/kernel/context-usage.ts'
import { applyCompactionState, emptyStreamState } from '../src/renderer/atoms/agent.ts'
import { toKernelMessages, type SessionMessage } from '../src/shared/types/message.ts'
import type { CompactionSourceEntry } from '../src/shared/types/session.ts'
import { replaySessionEntries } from '../src/main/session-store.ts'

describe('上下文压缩', () => {
  test('自动阈值与稍后冷却正确生效', () => {
    expect(shouldScheduleCompaction(84_999, 100_000)).toBe(false)
    expect(shouldScheduleCompaction(85_000, 100_000)).toBe(true)
    expect(shouldScheduleCompaction(89_999, 100_000, 85_000)).toBe(false)
    expect(shouldScheduleCompaction(90_000, 100_000, 85_000)).toBe(true)
  })

  test('线性日志会转换成带父指针的 pi 压缩输入', () => {
    const message = kernelMessage('m1', 'hello')
    const entries: CompactionSourceEntry[] = [
      { type: 'message', id: 'm1', timestamp: 1, message },
      {
        type: 'compaction',
        id: 'c1',
        timestamp: 2,
        summary: '摘要',
        firstKeptEntryId: 'm1',
        tokensBefore: 100,
        compactedCount: 1,
      },
    ]

    const converted = toPiEntries(entries)
    expect(converted[0]?.parentId).toBeNull()
    expect(converted[1]?.parentId).toBe('m1')
    expect(converted[1]?.type).toBe('compaction')
  })

  test('压缩摘要会转换成模型可读的 user 消息', () => {
    const messages: SessionMessage[] = [
      {
        kind: 'compaction',
        id: 'c1',
        createdAt: 1,
        summary: '重要摘要',
        compactedCount: 4,
        tokensBefore: 12_000,
        firstKeptEntryId: 'm5',
      },
      kernelMessage('m5', '继续'),
    ]

    const llm = convertStoredMessagesToLlm(toKernelMessages(messages))
    expect(llm[0]?.role).toBe('user')
    expect(JSON.stringify(llm[0])).toContain('重要摘要')
  })

  test('压缩后的即时统计不复用旧 assistant usage', () => {
    const messages = toKernelMessages([
      {
        kind: 'compaction',
        id: 'c1',
        createdAt: 1,
        summary: '短摘要',
        compactedCount: 20,
        tokensBefore: 90_000,
        firstKeptEntryId: 'm1',
      },
      kernelMessage('m1', '保留消息'),
    ])
    const usage = buildPostCompactionUsage(messages, undefined, 100_000)

    expect(usage.usedTokens).toBeLessThan(1_000)
    expect(usage.percent).toBeLessThan(1)
  })

  test('renderer 压缩状态能完整清理', () => {
    const scheduled = applyCompactionState(emptyStreamState(), {
      type: 'scheduled',
      deadlineAt: 123,
    })
    const running = applyCompactionState(scheduled, { type: 'running', compactedCount: 8 })
    const cleared = applyCompactionState(running, { type: 'clear' })

    expect(scheduled.compaction?.status).toBe('scheduled')
    expect(running.compaction?.compactedCount).toBe(8)
    expect(cleared.compaction).toBeUndefined()
  })

  test('重复压缩只重放最新摘要及其保留边界后的消息', () => {
    const m1 = kernelMessage('m1', '旧消息')
    const m2 = kernelMessage('m2', '中间消息')
    const m3 = kernelMessage('m3', '最近消息')
    const replayed = replaySessionEntries([
      { type: 'message', id: 'm1', timestamp: 1, message: m1 },
      { type: 'message', id: 'm2', timestamp: 2, message: m2 },
      {
        type: 'compaction',
        id: 'c1',
        timestamp: 3,
        summary: '第一次摘要',
        firstKeptEntryId: 'm2',
        tokensBefore: 100,
        compactedCount: 1,
      },
      { type: 'message', id: 'm3', timestamp: 4, message: m3 },
      {
        type: 'compaction',
        id: 'c2',
        timestamp: 5,
        summary: '第二次摘要',
        firstKeptEntryId: 'm3',
        tokensBefore: 120,
        compactedCount: 2,
      },
    ])

    expect(replayed.map((message) => message.id)).toEqual(['c2', 'm3'])
    expect(replayed[0]?.kind).toBe('compaction')
  })
})

function kernelMessage(id: string, text: string): SessionMessage {
  return {
    kind: 'kernel',
    id,
    createdAt: 1,
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
  }
}
