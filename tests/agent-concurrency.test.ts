import { describe, expect, test } from 'bun:test'
import {
  createRunCoordinator,
  RunRegistry,
  type AgentEngine,
  type AgentInvocation,
  type RunSessionLifecycle,
} from '../src/runtime/index.ts'
import type { SendInput } from '../src/shared/contracts/ipc.ts'
import type { StreamFrame } from '../src/shared/contracts/events.ts'
import {
  acceptRunFrame,
  applyAgentEvent,
  applyCompactionState,
  dequeueQueuedPrompt,
  emptyStreamState,
  indexPendingRequests,
  mergePendingRequests,
  replaceSession,
  settleRunFrame,
  updateSessionMode,
  type RunFrameCursor,
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
    cwd: 'C:\\fixture',
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

function createLifecycle(): RunSessionLifecycle {
  return {
    started: (sessionId) => Promise.resolve({
      id: sessionId,
      title: sessionId,
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
    }),
    settled: ({ sessionId, status, detail }) => Promise.resolve({
      id: sessionId,
      title: sessionId,
      status,
      ...(detail ? { statusDetail: detail } : {}),
      createdAt: 1,
      updatedAt: 3,
    }),
  }
}

describe('Agent 并发状态', () => {
  test('旧 run 的迟到帧会被丢弃', () => {
    const active = new Map<string, RunFrameCursor>()

    expect(acceptRunFrame(active, 'session-1', 10)).toBe(true)
    expect(acceptRunFrame(active, 'session-1', 9)).toBe(false)
    settleRunFrame(active, 'session-1', 10)
    expect(acceptRunFrame(active, 'session-1', 10)).toBe(false)
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

  test('Session settled 事件替换侧栏状态并按更新时间重排', () => {
    const sessions = [
      { id: 'session-1', title: '一', createdAt: 1, updatedAt: 3 },
      { id: 'session-2', title: '二', createdAt: 1, updatedAt: 2 },
    ]

    const updated = replaceSession(sessions, {
      ...sessions[1]!,
      status: 'failed',
      statusDetail: '认证失败',
      updatedAt: 4,
    })

    expect(updated.map((session) => session.id)).toEqual([
      'session-2',
      'session-1',
    ])
    expect(updated[0]?.status).toBe('failed')
    expect(updated[0]?.statusDetail).toBe('认证失败')
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

  test('压缩完成只会取走当前 Session 的一条排队输入', () => {
    const prompts = new Map([
      ['session-1', '压缩后发送'],
      ['session-2', '保持排队'],
    ])

    const first = dequeueQueuedPrompt(prompts, 'session-1')
    const duplicate = dequeueQueuedPrompt(first.prompts, 'session-1')

    expect(first.text).toBe('压缩后发送')
    expect(first.prompts.has('session-1')).toBe(false)
    expect(first.prompts.get('session-2')).toBe('保持排队')
    expect(duplicate.text).toBeUndefined()
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
    expect(first?.signal.aborted).toBe(false)
    expect(registry.cancel('session-1')).toBe(true)
    expect(first?.signal.aborted).toBe(true)
    expect(registry.cancel('session-1')).toBe(false)

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
  test('把模型调用护栏、turn usage 与 settled 串到同一 ContextService', async () => {
    const calls: string[] = []
    const engine: AgentEngine = {
      async *run(invocation) {
        const compacted = await invocation.beforeModelCall?.(85, 100)
        calls.push(`engine.compacted:${String(compacted)}`)
        yield {
          type: 'turn_end',
          usage: {
            input: 80,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 85,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        }
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      createInvocation,
      lifecycle: createLifecycle(),
      context: {
        async beforeModelCall(input) {
          calls.push(`context.before:${input.contextTokens}`)
          return true
        },
        observeTurn(input) {
          calls.push(`context.turn:${input.usage.totalTokens}`)
        },
        runSettled(sessionId) {
          calls.push(`context.settled:${sessionId}`)
        },
      },
    })

    await coordinator.send({ sessionId: 'session-1', text: '继续' }, () => {})

    expect(calls).toEqual([
      'context.before:85',
      'engine.compacted:true',
      'context.turn:85',
      'context.settled:session-1',
    ])
  })

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
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      createInvocation,
      lifecycle: createLifecycle(),
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
      async *run(invocation, signal) {
        const gate = deferred()
        pending.set(invocation.sessionId, gate)
        if (signal.aborted) gate.resolve()
        signal.addEventListener('abort', gate.resolve, { once: true })
        await gate.promise
      },
      async dispose() {
        stopped.push(...pending.keys())
      },
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      createInvocation,
      lifecycle: createLifecycle(),
    })
    void coordinator.send({ sessionId: 'session-1', text: '一' }, () => {})
    void coordinator.send({ sessionId: 'session-2', text: '二' }, () => {})
    await flushCoordinator()

    await coordinator.dispose()

    expect(stopped).toEqual(['session-1', 'session-2'])
    expect(coordinator.isRunning('session-1')).toBe(false)
    expect(coordinator.isRunning('session-2')).toBe(false)
  })

  test('stop 幂等触发 AbortSignal，丢弃停止后的 engine 迟到事件并 settled 为 interrupted', async () => {
    const started = deferred()
    const settlements: Array<{
      sessionId: string
      status: 'idle' | 'done' | 'failed' | 'interrupted'
      detail?: string
    }> = []
    const frames: StreamFrame[] = []
    const engine: AgentEngine = {
      async *run(_invocation, signal) {
        yield { type: 'run_start' }
        started.resolve()
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        }
        yield { type: 'text_delta', delta: '迟到内容' }
        yield { type: 'run_end', stopReason: 'aborted' }
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      createInvocation,
      lifecycle: {
        started: (sessionId) => Promise.resolve({
          id: sessionId,
          title: sessionId,
          status: 'running',
          createdAt: 1,
          updatedAt: 2,
        }),
        settled: (settlement) => {
          settlements.push({
            sessionId: settlement.sessionId,
            status: settlement.status,
            ...(settlement.detail ? { detail: settlement.detail } : {}),
          })
          return Promise.resolve({
            id: settlement.sessionId,
            title: settlement.sessionId,
            status: settlement.status,
            createdAt: 1,
            updatedAt: 3,
          })
        },
      },
    })

    const operation = coordinator.send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )
    await started.promise
    coordinator.stop('session-1')
    coordinator.stop('session-1')
    await operation

    expect(settlements).toEqual([{
      sessionId: 'session-1',
      status: 'interrupted',
      detail: '用户已停止',
    }])
    expect(
      frames.some(
        (frame) =>
          frame.payload.channel === 'agent'
          && frame.payload.event.type === 'text_delta',
      ),
    ).toBe(false)
    expect(frames.at(-1)).toEqual({
      sessionId: 'session-1',
      runId: 1,
      payload: {
        channel: 'agent',
        event: { type: 'run_end', stopReason: 'aborted' },
      },
    })
  })
})
