import { describe, expect, test } from 'bun:test'
import {
  createContextService,
  type ContextClock,
} from '../../../src/runtime/context/context-service.ts'
import type {
  ContextCompactor,
  ContextUsageEstimateInput,
  PreparedContextCompaction,
} from '../../../src/runtime/context/ports/context-compactor.ts'
import type {
  AppendCompactionInput,
  SessionMessageHistory,
} from '../../../src/runtime/sessions/session-message-history.ts'
import type { Channel } from '../../../src/shared/contracts/channel.ts'
import type { ContextUsage } from '../../../src/shared/contracts/context.ts'
import type { StreamFrame } from '../../../src/shared/contracts/events.ts'
import type {
  CompactionMessage,
  SessionMessage,
} from '../../../src/shared/contracts/message.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'

const CHANNEL: Channel = {
  id: 'channel-1',
  name: '测试渠道',
  protocol: 'openai',
  baseUrl: 'https://example.com',
  apiKey: 'test',
  models: [{
    id: 'model-1',
    name: '测试模型',
    contextWindow: 100_000,
    maxTokens: 8_000,
  }],
}

const USAGE: ContextUsage = {
  usedTokens: 500,
  contextWindow: 100_000,
  percent: 0.5,
  breakdown: {
    systemPrompt: 100,
    tools: 100,
    messages: 300,
    skills: 0,
    mcp: 0,
  },
  outputTokens: 20,
  costUsd: 0.01,
  updatedAt: 100,
}

interface Fixture {
  frames: StreamFrame[]
  messages: SessionMessage[]
  session: SessionMeta
  appended: AppendCompactionInput[]
  usageInputs: ContextUsageEstimateInput[]
  history: SessionMessageHistory
}

interface FakeTimer {
  id: number
  deadlineAt: number
  callback(): void
}

class FakeClock implements ContextClock {
  current = 100
  #nextId = 1
  readonly #timers = new Map<number, FakeTimer>()

  now(): number {
    return this.current
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const timer = {
      id: this.#nextId++,
      deadlineAt: this.current + delayMs,
      callback,
    }
    this.#timers.set(timer.id, timer)
    return timer.id
  }

  clearTimeout(timer: unknown): void {
    if (typeof timer === 'number') this.#timers.delete(timer)
  }

  advance(ms: number): void {
    this.current += ms
    const due = [...this.#timers.values()]
      .filter((timer) => timer.deadlineAt <= this.current)
      .sort((left, right) => left.deadlineAt - right.deadlineAt)
    for (const timer of due) {
      this.#timers.delete(timer.id)
      timer.callback()
    }
  }
}

function createFixture(): Fixture {
  const frames: StreamFrame[] = []
  const appended: AppendCompactionInput[] = []
  const usageInputs: ContextUsageEstimateInput[] = []
  const session: SessionMeta = {
    id: 'session-1',
    title: '测试会话',
    channelId: CHANNEL.id,
    modelId: 'model-1',
    contextUsage: {
      ...USAGE,
      usedTokens: 90_000,
      percent: 90,
    },
    createdAt: 1,
    updatedAt: 1,
  }
  const messages: SessionMessage[] = [
    userMessage('message-1', '旧消息一', 1),
    userMessage('message-2', '旧消息二', 2),
    userMessage('message-3', '保留消息', 3),
  ]

  const history: SessionMessageHistory = {
    async create() {},
    async messages() {
      return [...messages]
    },
    async compactedMessages() {
      return []
    },
    async truncate() {
      return []
    },
    async clonePrefix() {
      return []
    },
    async compactionSourceEntries() {
      return messages.map((message) => {
        if (message.kind === 'compaction') {
          return {
            type: 'compaction' as const,
            id: message.id,
            timestamp: message.createdAt,
            summary: message.summary,
            firstKeptEntryId: message.firstKeptEntryId,
            tokensBefore: message.tokensBefore,
            compactedCount: message.compactedCount,
          }
        }
        return {
          type: 'message' as const,
          id: message.id,
          timestamp: message.createdAt,
          message,
        }
      })
    },
    async append() {},
    async appendCompaction(_sessionId, input) {
      appended.push(input)
      const marker: CompactionMessage = {
        kind: 'compaction',
        id: 'compaction-1',
        createdAt: 4,
        summary: input.summary,
        compactedCount: 2,
        tokensBefore: input.tokensBefore,
        firstKeptEntryId: input.firstKeptEntryId,
      }
      messages.splice(0, messages.length, marker, messages[2]!)
      return marker
    },
    async delete() {},
  }

  return {
    frames,
    messages,
    session,
    appended,
    usageInputs,
    history,
  }
}

function createCompactor(
  fixture: Fixture,
  execute: PreparedContextCompaction['execute'] = async () => ({
      summary: '压缩摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 90_000,
      outputTokens: 20,
      costUsd: 0.01,
    }),
): ContextCompactor {
  return {
    prepare() {
      return {
        compactedCount: 2,
        contextWindow: 100_000,
        execute,
      }
    },
    estimateUsage(input) {
      fixture.usageInputs.push(input)
      return USAGE
    },
  }
}

function createService(
  fixture: Fixture,
  compactor: ContextCompactor,
  clock?: ContextClock,
) {
  return createContextService({
    sessions: {
      list: () => [fixture.session],
      updateMeta(_sessionId, patch) {
        Object.assign(fixture.session, patch)
        return fixture.session
      },
    },
    history: fixture.history,
    channels: { list: () => [CHANNEL] },
    compactor,
    ...(clock ? { clock } : {}),
  })
}

function emitTo(fixture: Fixture): (frame: StreamFrame) => void {
  return (frame) => fixture.frames.push(frame)
}

function hostEventTypes(frames: StreamFrame[]): string[] {
  return frames.flatMap((frame) =>
    frame.payload.channel === 'host' ? [frame.payload.event.type] : [],
  )
}

function turnUsage(totalTokens: number) {
  return {
    input: Math.max(0, totalTokens - 100),
    output: 100,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ContextService', () => {
  test('手动压缩成功后持久化摘要，并使用压缩后的历史重建上下文用量', async () => {
    const fixture = createFixture()
    const service = createService(fixture, createCompactor(fixture))

    await service.start('session-1', emitTo(fixture))

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_start',
      'compaction_end',
    ])
    expect(fixture.appended).toEqual([{
      summary: '压缩摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 90_000,
    }])
    expect(fixture.usageInputs[0]?.messages.map((message) => message.id)).toEqual([
      'compaction-1',
      'message-3',
    ])
    expect(fixture.session.contextUsage).toEqual(USAGE)
    expect(service.isCompacting('session-1')).toBe(false)
  })

  test('准备压缩失败时发布可恢复错误且不进入运行态', async () => {
    const fixture = createFixture()
    const compactor = createCompactor(fixture)
    compactor.prepare = () => {
      throw new Error('上下文还很短')
    }
    const service = createService(fixture, compactor)

    await service.start('session-1', emitTo(fixture))

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_cancelled',
      'host_error',
    ])
    expect(service.isCompacting('session-1')).toBe(false)
  })

  test('摘要执行失败时结束运行态并发布错误', async () => {
    const fixture = createFixture()
    const service = createService(
      fixture,
      createCompactor(fixture, async () => {
        throw new Error('模型不可用')
      }),
    )

    await service.start('session-1', emitTo(fixture))

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_start',
      'compaction_cancelled',
      'host_error',
    ])
    expect(fixture.appended).toHaveLength(0)
  })

  test('取消正在执行的摘要时只发布取消事件，不误报模型失败', async () => {
    const fixture = createFixture()
    let started = (): void => {}
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const service = createService(
      fixture,
      createCompactor(fixture, (signal) =>
        new Promise((_resolve, reject) => {
          started()
          signal.addEventListener('abort', () => reject(new Error('已中止')), {
            once: true,
          })
        })),
    )

    const completion = service.start('session-1', emitTo(fixture))
    await ready
    service.cancel('session-1', emitTo(fixture))
    await completion

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_start',
      'compaction_cancelled',
    ])
    expect(fixture.appended).toHaveLength(0)
  })

  test('84% 不调度，达到 85% 后显示三秒倒计时', () => {
    const fixture = createFixture()
    const clock = new FakeClock()
    const service = createService(fixture, createCompactor(fixture), clock)
    let running = false

    service.observeTurn({
      sessionId: 'session-1',
      usage: turnUsage(84_999),
      contextWindow: 100_000,
      emit: emitTo(fixture),
      isRunning: () => running,
    })
    service.observeTurn({
      sessionId: 'session-1',
      usage: turnUsage(85_000),
      contextWindow: 100_000,
      emit: emitTo(fixture),
      isRunning: () => running,
    })

    expect(hostEventTypes(fixture.frames)).toEqual([
      'context_usage',
      'context_usage',
      'compaction_scheduled',
    ])
    expect(
      fixture.frames.find(
        (frame) =>
          frame.payload.channel === 'host'
          && frame.payload.event.type === 'compaction_scheduled',
      ),
    ).toEqual({
      sessionId: 'session-1',
      runId: 0,
      payload: {
        channel: 'host',
        event: { type: 'compaction_scheduled', deadlineAt: 3_100 },
      },
    })
    running = true
  })

  test('稍后会取消本次倒计时，直到用量再增加 5% 才重新调度', () => {
    const fixture = createFixture()
    const clock = new FakeClock()
    const service = createService(fixture, createCompactor(fixture), clock)
    const observe = (usedTokens: number): void => service.observeTurn({
      sessionId: 'session-1',
      usage: turnUsage(usedTokens),
      contextWindow: 100_000,
      emit: emitTo(fixture),
      isRunning: () => false,
    })

    observe(85_000)
    service.defer('session-1', emitTo(fixture))
    clock.advance(3_000)
    observe(89_999)
    observe(90_000)

    expect(hostEventTypes(fixture.frames)).toEqual([
      'context_usage',
      'compaction_scheduled',
      'compaction_cancelled',
      'context_usage',
      'context_usage',
      'compaction_scheduled',
    ])
    expect(fixture.appended).toHaveLength(0)
  })

  test('倒计时到期时 Run 未结束则排队，并在 settled 后立即压缩', async () => {
    const fixture = createFixture()
    const clock = new FakeClock()
    const service = createService(fixture, createCompactor(fixture), clock)

    service.observeTurn({
      sessionId: 'session-1',
      usage: turnUsage(85_000),
      contextWindow: 100_000,
      emit: emitTo(fixture),
      isRunning: () => true,
    })
    clock.advance(3_000)

    expect(hostEventTypes(fixture.frames)).toEqual([
      'context_usage',
      'compaction_scheduled',
      'compaction_queued',
    ])

    service.runSettled('session-1')
    await flushAsyncWork()

    expect(hostEventTypes(fixture.frames)).toEqual([
      'context_usage',
      'compaction_scheduled',
      'compaction_queued',
      'compaction_start',
      'compaction_end',
    ])
    expect(fixture.appended).toHaveLength(1)
  })

  test('下一次模型调用前达到阈值会取消倒计时并同步完成压缩', async () => {
    const fixture = createFixture()
    const clock = new FakeClock()
    const service = createService(fixture, createCompactor(fixture), clock)
    service.observeTurn({
      sessionId: 'session-1',
      usage: turnUsage(85_000),
      contextWindow: 100_000,
      emit: emitTo(fixture),
      isRunning: () => true,
    })

    const compacted = await service.beforeModelCall({
      sessionId: 'session-1',
      contextTokens: 85_000,
      contextWindow: 100_000,
      emit: emitTo(fixture),
    })
    clock.advance(3_000)

    expect(compacted).toBe(true)
    expect(hostEventTypes(fixture.frames)).toEqual([
      'context_usage',
      'compaction_scheduled',
      'compaction_start',
      'compaction_end',
    ])
    expect(fixture.appended).toHaveLength(1)
  })
})

function userMessage(
  id: string,
  text: string,
  createdAt: number,
): SessionMessage {
  return {
    kind: 'kernel',
    id,
    createdAt,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: createdAt,
    },
  }
}
