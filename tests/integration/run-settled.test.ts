import { describe, expect, test } from 'bun:test'
import {
  createRunCoordinator,
  type AgentEngine,
  type AgentInvocation,
  type RunSessionLifecycle,
  type RunSettlement,
} from '../../src/runtime/index.ts'
import type {
  AgentEvent,
  StreamFrame,
} from '../../src/shared/contracts/events.ts'

function invocation(sessionId: string): AgentInvocation {
  return {
    sessionId,
    text: '开始',
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
  }
}

function assistantMessage(
  stopReason: 'stop' | 'error' = 'stop',
) {
  return {
    kind: 'kernel' as const,
    id: 'message-1',
    createdAt: 100,
    message: {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: '完成' }],
      api: 'openai-completions',
      provider: 'test',
      model: 'test-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason,
      ...(stopReason === 'error' ? { errorMessage: '认证失败' } : {}),
      timestamp: 100,
    },
  }
}

interface LifecycleHarness {
  lifecycle: RunSessionLifecycle
  settlements: RunSettlement[]
}

function lifecycleHarness(options: {
  settleError?: Error
} = {}): LifecycleHarness {
  const settlements: RunSettlement[] = []
  return {
    settlements,
    lifecycle: {
      started: (sessionId) => Promise.resolve({
        id: sessionId,
        title: '测试',
        status: 'running',
        lastActivity: '正在思考…',
        createdAt: 1,
        updatedAt: 2,
      }),
      async settled(settlement) {
        settlements.push(settlement)
        if (options.settleError) throw options.settleError
        return {
          id: settlement.sessionId,
          title: '测试',
          status: settlement.status,
          ...(settlement.detail
            ? { statusDetail: settlement.detail }
            : {}),
          createdAt: 1,
          updatedAt: 3,
        }
      },
    },
  }
}

function coordinatorFor(
  engine: AgentEngine,
  lifecycle: RunSessionLifecycle,
) {
  return createRunCoordinator({
    now: () => 1,
    engine,
    lifecycle,
    createInvocation: (input) =>
      Promise.resolve(invocation(input.sessionId)),
  })
}

function frameTypes(frames: StreamFrame[]): string[] {
  return frames.map((frame) => frame.payload.event.type)
}

describe('Run settled', () => {
  test('完整 message_end 先可见，再把 Session 更新为 done，最后发布 run_end', async () => {
    const engine: AgentEngine = {
      async *run() {
        yield { type: 'run_start' }
        yield {
          type: 'message_end',
          message: assistantMessage(),
        }
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const harness = lifecycleHarness()
    const frames: StreamFrame[] = []

    await coordinatorFor(engine, harness.lifecycle).send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(frameTypes(frames)).toEqual([
      'session_updated',
      'run_start',
      'message_end',
      'session_updated',
      'pending_requests_cleared',
      'run_end',
    ])
    expect(harness.settlements).toEqual([{
      sessionId: 'session-1',
      status: 'done',
    }])
  })

  test('pi error event 保持时间线可见，并把 Session 持久化为 failed', async () => {
    const engine: AgentEngine = {
      async *run() {
        yield { type: 'run_start' }
        yield {
          type: 'error',
          reason: 'error',
          message: '认证失败',
        }
        yield {
          type: 'message_end',
          message: assistantMessage('error'),
        }
        yield { type: 'run_end', stopReason: 'error' }
      },
      async dispose() {},
    }
    const harness = lifecycleHarness()
    const frames: StreamFrame[] = []

    await coordinatorFor(engine, harness.lifecycle).send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(harness.settlements).toEqual([{
      sessionId: 'session-1',
      status: 'failed',
      detail: '认证失败',
    }])
    expect(frameTypes(frames)).toContain('error')
    expect(frameTypes(frames)).not.toContain('host_error')
  })

  test('engine throw 兼容路径仍 settled，并发布 host_error', async () => {
    const engine: AgentEngine = {
      async *run(): AsyncIterable<AgentEvent> {
        throw new Error('engine 崩溃')
      },
      async dispose() {},
    }
    const harness = lifecycleHarness()
    const frames: StreamFrame[] = []

    await coordinatorFor(engine, harness.lifecycle).send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(harness.settlements[0]).toEqual({
      sessionId: 'session-1',
      status: 'failed',
      detail: 'engine 崩溃',
    })
    expect(frameTypes(frames)).toContain('host_error')
  })

  test('message_end 落盘失败按 engine failure 收口，不伪造成功', async () => {
    const engine: AgentEngine = {
      async *run() {
        yield { type: 'run_start' }
        throw new Error('message_end 落盘失败')
      },
      async dispose() {},
    }
    const harness = lifecycleHarness()
    const frames: StreamFrame[] = []

    await coordinatorFor(engine, harness.lifecycle).send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(harness.settlements[0]).toEqual({
      sessionId: 'session-1',
      status: 'failed',
      detail: 'message_end 落盘失败',
    })
    expect(frameTypes(frames)).not.toContain('message_end')
    expect(frameTypes(frames)).toContain('host_error')
  })

  test('重复 run_end 只触发一次 settled 和一次终态事件', async () => {
    const engine: AgentEngine = {
      async *run() {
        yield { type: 'run_start' }
        yield { type: 'run_end', stopReason: 'stop' }
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const harness = lifecycleHarness()
    const frames: StreamFrame[] = []

    await coordinatorFor(engine, harness.lifecycle).send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(harness.settlements).toHaveLength(1)
    expect(
      frameTypes(frames).filter((type) => type === 'run_end'),
    ).toHaveLength(1)
  })

  test('Session 状态提交失败仍释放 Run 并显示宿主错误', async () => {
    const engine: AgentEngine = {
      async *run() {
        yield { type: 'run_start' }
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const harness = lifecycleHarness({
      settleError: new Error('Session 状态写入失败'),
    })
    const frames: StreamFrame[] = []
    const coordinator = coordinatorFor(engine, harness.lifecycle)

    await coordinator.send(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(coordinator.isRunning('session-1')).toBe(false)
    expect(frameTypes(frames)).toContain('host_error')
  })
})
