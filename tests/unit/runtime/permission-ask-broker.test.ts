import { describe, expect, test } from 'bun:test'
import {
  createPermissionAskBroker,
  createPolicyEngine,
  type PermissionAskBroker,
} from '../../../src/runtime/index.ts'
import type { PermissionRequest } from '../../../src/shared/contracts/permission.ts'

interface HarnessOptions {
  emit?(request: PermissionRequest): void
}

function harness(options: HarnessOptions = {}): {
  broker: PermissionAskBroker
  emitted: PermissionRequest[]
} {
  const emitted: PermissionRequest[] = []
  let sequence = 0
  const broker = createPermissionAskBroker({
    createId: () => `request-${++sequence}`,
    emitRequest(request) {
      emitted.push(request)
      options.emit?.(request)
    },
  })
  return { broker, emitted }
}

function writeInput(overrides: Partial<{ toolName: string; args: Record<string, unknown> }> = {}) {
  return {
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    toolName: 'write',
    args: { path: 'C:\\work\\a.md' },
    ...overrides,
  }
}

describe('PermissionAskBroker', () => {
  test('ask 登记请求并推送，pending 快照可恢复（重载）', async () => {
    const { broker, emitted } = harness()
    const result = broker.ask(writeInput(), new AbortController().signal)

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      requestId: 'request-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'write',
    })
    expect(broker.pending()).toHaveLength(1)
    expect(broker.pending()[0]?.requestId).toBe('request-1')

    broker.respond({ requestId: 'request-1', allowed: true })
    await expect(result).resolves.toBe(true)
    expect(broker.pending()).toEqual([])
  })

  test('respond(false) 拒绝；重复响应被忽略且不影响结果', async () => {
    const { broker } = harness()
    const result = broker.ask(writeInput(), new AbortController().signal)

    expect(broker.respond({ requestId: 'request-1', allowed: false })).toBe(true)
    await expect(result).resolves.toBe(false)
    expect(broker.pending()).toEqual([])
    expect(broker.respond({ requestId: 'request-1', allowed: true })).toBe(false)
  })

  test('AbortSignal 中止时释放挂起（stop 清理）', async () => {
    const { broker, emitted } = harness()
    const controller = new AbortController()
    const result = broker.ask(writeInput(), controller.signal)
    expect(emitted).toHaveLength(1)

    controller.abort()

    await expect(result).resolves.toBe(false)
    expect(broker.pending()).toEqual([])
  })

  test('已经中断的 signal 不推送 UI 且立即释放', async () => {
    const { broker, emitted } = harness()
    const controller = new AbortController()
    controller.abort()

    const result = broker.ask(writeInput(), controller.signal)

    await expect(result).resolves.toBe(false)
    expect(emitted).toHaveLength(0)
    expect(broker.pending()).toEqual([])
  })

  test('clearSession 只清理目标会话（session 隔离）', async () => {
    const { broker } = harness()
    const first = broker.ask(
      writeInput({ toolCallId: 'tool-a' }),
      new AbortController().signal,
    )
    const second = broker.ask(
      writeInput({ sessionId: 'session-2', toolCallId: 'tool-b' }),
      new AbortController().signal,
    )

    broker.clearSession('session-1')

    await expect(first).resolves.toBe(false)
    expect(broker.pending()).toHaveLength(1)
    expect(broker.pending()[0]?.sessionId).toBe('session-2')

    broker.clearSession('session-2')
    await expect(second).resolves.toBe(false)
    expect(broker.pending()).toEqual([])
  })

  test('推送失败时调用方可见错误，不留下悬挂记录', async () => {
    const { broker } = harness({
      emit() {
        throw new Error('窗口已销毁')
      },
    })
    const result = broker.ask(writeInput(), new AbortController().signal)

    await expect(result).rejects.toThrow('窗口已销毁')
    expect(broker.pending()).toEqual([])
  })

  test('请求字段：写工具 medium + 路径候选，破坏性命令 high 且无候选', async () => {
    const { broker, emitted } = harness()
    const writeResult = broker.ask(writeInput(), new AbortController().signal)
    const destructiveResult = broker.ask(
      writeInput({
        toolName: 'bash',
        args: { command: 'rm -rf C:\\work\\cache' },
      }),
      new AbortController().signal,
    )

    expect(emitted[0]).toMatchObject({
      risk: 'medium',
      neverPersist: false,
      affectedPaths: ['C:\\work\\a.md'],
    })
    expect(emitted[0]?.suggestedGrants.length).toBeGreaterThan(0)

    expect(emitted[1]).toMatchObject({
      risk: 'high',
      neverPersist: true,
    })
    expect(emitted[1]?.suggestedGrants).toEqual([])

    broker.respond({ requestId: 'request-1', allowed: true })
    broker.respond({ requestId: 'request-2', allowed: true })
    await Promise.all([writeResult, destructiveResult])
  })

  test('PolicyEngine + broker 集成：写工具 ask 挂起，允许后放行', async () => {
    const { broker } = harness()
    const policy = createPolicyEngine({
      rules: {
        list: () => [],
      },
      getMode: () => 'auto',
      getWorkspaceId: () => 'ws-1',
      ask: (input, signal) => broker.ask(input, signal),
    })
    const controller = new AbortController()
    const decision = policy.evaluate(
      {
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'write',
        args: { path: 'C:\\work\\a.md' },
      },
      controller.signal,
    )

    expect(broker.pending()).toHaveLength(1)
    broker.respond({ requestId: broker.pending()[0]!.requestId, allowed: true })
    await expect(decision).resolves.toEqual({ action: 'allow' })
    expect(broker.pending()).toEqual([])
  })
})
