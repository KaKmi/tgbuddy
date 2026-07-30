import { describe, expect, test } from 'bun:test'
import {
  createRunCoordinator,
  RunRegistry,
  type AgentEngine,
  type AgentInvocation,
} from '../src/runtime/index.ts'
import type { SendInput } from '../src/shared/contracts/ipc.ts'
import type { StreamFrame } from '../src/shared/contracts/events.ts'
import {
  acceptRunFrame,
  applyAgentEvent,
  applyCompactionState,
  emptyStreamState,
  indexPendingRequests,
  mergePendingRequests,
  updateSessionMode,
} from '../src/renderer/atoms/agent.ts'

interface TestRequest {
  requestId: string
  sessionId: string
}

interface Deferred {
  promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createInvocation(input: SendInput): Promise<AgentInvocation> {
  return Promise.resolve({
    sessionId: input.sessionId,
    text: input.text,
    channel: {
      id: 'test',
      name: 'Test',
      protocol: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      models: [{
        id: 'test-model',
        name: 'Test Model',
        contextWindow: 4096,
        maxTokens: 1024,
      }],
    },
    modelId: 'test-model',
    systemPrompt: '测试',
  })
}

async function flushCoordinator(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Agent 并发状态', () => {
  test('旧 run 的迟到帧会被丢弃', () => {
    const active = new Map<string, number>()

    expect(acceptRunFrame(active, 'session-1', 10)).toBe(true)
    expect(acceptRunFrame(active, 'session-1', 9)).toBe(false)
    expect(acceptRunFrame(active, 'session-1', 11)).toBe(true)
    expect(acceptRunFrame(active, 'session-2', 1)).toBe(true)
  })

  test('挂起请求快照按会话合并并去重', () => {
    const current = new Map<string, TestRequest[]>([
      ['session-1', [{ requestId: 'req-1', sessionId: 'session-1' }]],
    ])

    const merged = mergePendingRequests(current, [
      { requestId: 'req-1', sessionId: 'session-1' },
      { requestId: 'req-2', sessionId: 'session-1' },
      { requestId: 'req-3', sessionId: 'session-2' },
    ])

    expect(merged.get('session-1')?.map((item) => item.requestId)).toEqual(['req-1', 'req-2'])
    expect(merged.get('session-2')?.map((item) => item.requestId)).toEqual(['req-3'])
  })

  test('全量快照不会保留已经消失的旧请求', () => {
    const snapshot = indexPendingRequests<TestRequest>([
      { requestId: 'req-2', sessionId: 'session-1' },
    ])

    expect(snapshot.get('session-1')?.map((item) => item.requestId)).toEqual(['req-2'])
    expect(snapshot.has('session-2')).toBe(false)
  })

  test('模式事件只更新对应会话的 Chip 状态', () => {
    const sessions = [
      { id: 'session-1', title: '一', createdAt: 1, updatedAt: 1, permissionMode: 'auto' as const },
      { id: 'session-2', title: '二', createdAt: 1, updatedAt: 1, permissionMode: 'auto' as const },
    ]

    const updated = updateSessionMode(sessions, 'session-1', 'plan')

    expect(updated[0]?.permissionMode).toBe('plan')
    expect(updated[1]?.permissionMode).toBe('auto')
  })

  test('run_start 不会抹掉自动压缩倒计时', () => {
    const scheduled = applyCompactionState(emptyStreamState(), {
      type: 'scheduled',
      deadlineAt: 123,
    })
    const running = applyAgentEvent(scheduled, { type: 'run_start' })

    expect(running.running).toBe(true)
    expect(running.compaction?.status).toBe('scheduled')
  })
})

describe('RunRegistry', () => {
  test('同 Session 单飞、跨 Session 并行，旧 token 不能释放新 Run', () => {
    const registry = new RunRegistry({ now: () => 100 })

    const first = registry.start('session-1')
    expect(registry.start('session-1')).toBeUndefined()
    const parallel = registry.start('session-2')
    expect(first?.runId).toBe(1)
    expect(parallel?.runId).toBe(2)

    expect(first && registry.settle(first)).toBe(true)
    const next = registry.start('session-1')
    expect(next?.runId).toBe(3)
    expect(first && registry.settle(first)).toBe(false)
    expect(registry.isRunning('session-1')).toBe(true)
  })

  test('dispose 清空 active Run 并拒绝新 Run', () => {
    const registry = new RunRegistry({ now: () => 100 })
    registry.start('session-1')
    registry.start('session-2')

    expect(registry.dispose().map((run) => run.sessionId)).toEqual([
      'session-1',
      'session-2',
    ])
    expect(registry.isRunning('session-1')).toBe(false)
    expect(() => registry.start('session-3')).toThrow('RunRegistry 已关闭')
  })
})

describe('RunCoordinator', () => {
  test('拒绝同 Session 重入，同时允许不同 Session 执行并在 settled 后释放', async () => {
    const pending = new Map<string, Deferred>()
    const started: AgentInvocation[] = []
    const frames: StreamFrame[] = []
    const engine: AgentEngine = {
      async *run(invocation) {
        started.push(invocation)
        yield { type: 'run_start' }
        const gate = deferred()
        pending.set(invocation.sessionId, gate)
        await gate.promise
        yield { type: 'run_end', stopReason: 'stop' }
      },
      abort() {},
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      createInvocation,
    })

    const first = coordinator.send(
      { sessionId: 'session-1', text: '一' },
      (frame) => frames.push(frame),
    )
    await flushCoordinator()
    await coordinator.send(
      { sessionId: 'session-1', text: '重复' },
      (frame) => frames.push(frame),
    )
    const parallel = coordinator.send(
      { sessionId: 'session-2', text: '二' },
      (frame) => frames.push(frame),
    )
    await flushCoordinator()

    expect(started.map((item) => item.sessionId)).toEqual([
      'session-1',
      'session-2',
    ])
    expect(
      frames
        .filter((frame) => frame.payload.channel === 'agent')
        .map((frame) => frame.runId),
    ).toEqual([1, 2])
    expect(frames).toContainEqual({
      sessionId: 'session-1',
      runId: 0,
      payload: {
        channel: 'host',
        event: {
          type: 'host_error',
          message: '上一条消息仍在处理中，请稍候',
          recoverable: true,
        },
      },
    })

    pending.get('session-1')?.resolve()
    await first
    expect(coordinator.isRunning('session-1')).toBe(false)
    const restarted = coordinator.send(
      { sessionId: 'session-1', text: '三' },
      (frame) => frames.push(frame),
    )
    await flushCoordinator()
    expect(started.at(-1)?.sessionId).toBe('session-1')
    expect(
      frames.findLast(
        (frame) =>
          frame.sessionId === 'session-1'
          && frame.payload.channel === 'agent'
          && frame.payload.event.type === 'run_start',
      )?.runId,
    ).toBe(3)

    pending.get('session-1')?.resolve()
    pending.get('session-2')?.resolve()
    await Promise.all([restarted, parallel])
  })

  test('dispose 停止并等待所有 active executor 后清空状态', async () => {
    const pending = new Map<string, Deferred>()
    const stopped: string[] = []
    const engine: AgentEngine = {
      async *run(invocation) {
        const gate = deferred()
        pending.set(invocation.sessionId, gate)
        await gate.promise
      },
      abort(sessionId) {
        stopped.push(sessionId)
        pending.get(sessionId)?.resolve()
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      createInvocation,
    })
    void coordinator.send({ sessionId: 'session-1', text: '一' }, () => {})
    void coordinator.send({ sessionId: 'session-2', text: '二' }, () => {})
    await flushCoordinator()

    await coordinator.dispose()

    expect(stopped).toEqual(['session-1', 'session-2'])
    expect(coordinator.isRunning('session-1')).toBe(false)
    expect(coordinator.isRunning('session-2')).toBe(false)
  })
})
