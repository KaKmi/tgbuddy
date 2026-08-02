import { describe, expect, test } from 'bun:test'
import {
  createPermissionAskBroker,
  createPolicyEngine,
  interactionResponseHash,
  type InteractionDecisionReceipt,
  type InteractionDecisionWriter,
  type PermissionAskBroker,
} from '../../../src/runtime/index.ts'
import type { PermissionRequest } from '../../../src/shared/contracts/permission.ts'

interface HarnessOptions {
  emit?(request: PermissionRequest): void
  decisionWriter?: InteractionDecisionWriter
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
    decisionWriter: options.decisionWriter,
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
  test('decision commit 成功前不 settle，重复响应幂等，冲突响应失败', async () => {
    let resolveCommit: ((receipt: InteractionDecisionReceipt) => void) | undefined
    let receipt: InteractionDecisionReceipt | undefined
    const writer: InteractionDecisionWriter = {
      commit: () => new Promise((resolve) => {
        resolveCommit = (value) => {
          receipt = value
          resolve(value)
        }
      }),
      findReceipt: () => receipt,
    }
    const { broker } = harness({ decisionWriter: writer })
    const result = broker.ask(writeInput(), new AbortController().signal)
    const response = { requestId: 'request-1', allowed: true }
    const responding = broker.respond(response)

    expect(await Promise.race([
      result.then(() => 'settled'),
      Promise.resolve('pending'),
    ])).toBe('pending')
    resolveCommit?.({
      status: 'committed',
      requestId: 'request-1',
      decisionId: 'decision-1',
      responseHash: interactionResponseHash(response),
      kind: 'permission',
      executionState: 'accepted_not_executed',
    })
    await expect(responding).resolves.toMatchObject({ decisionId: 'decision-1' })
    await expect(result).resolves.toMatchObject({ allowed: true, decisionId: 'decision-1' })
    const duplicates = await Promise.all(Array.from({ length: 10 }, () => broker.respond(response)))
    expect(new Set(duplicates.map((item) => item?.decisionId))).toEqual(new Set(['decision-1']))
    await expect(broker.respond({ requestId: 'request-1', allowed: false }))
      .rejects.toMatchObject({ code: 'interaction_response_conflict' })
  })

  test('根目录文件的候选粒度包含精确文件匹配，避免「总是允许」建了也命中不了', () => {
    const { broker, emitted } = harness()
    void broker.ask(
      writeInput({ args: { path: 'm2-write.txt' } }),
      new AbortController().signal,
    )

    const request = emitted[0]
    expect(request?.suggestedGrants[0]).toEqual({
      match: 'path',
      pattern: 'm2-write.txt',
      label: '放行 m2-write.txt',
    })
    // 工具级兜底候选仍在
    expect(request?.suggestedGrants[1]).toMatchObject({
      match: 'tool',
      pattern: 'write',
    })

    // 嵌套路径保留目录级候选，且精确文件候选不丢失
    void broker.ask(
      writeInput({ args: { path: 'docs/report.md' } }),
      new AbortController().signal,
    )
    expect(emitted[1]?.suggestedGrants[0]).toMatchObject({
      match: 'path',
      pattern: 'docs/**',
    })
    expect(emitted[1]?.suggestedGrants[1]).toMatchObject({
      match: 'path',
      pattern: 'docs/report.md',
    })
    expect(emitted[1]?.suggestedGrants[2]).toMatchObject({
      match: 'tool',
      pattern: 'write',
    })
  })

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

    await broker.respond({ requestId: 'request-1', allowed: true })
    await expect(result).resolves.toEqual({ allowed: true })
    expect(broker.pending()).toEqual([])
  })

  test('respond(false) 拒绝；重复响应被忽略且不影响结果', async () => {
    const { broker } = harness()
    const result = broker.ask(writeInput(), new AbortController().signal)

    await expect(broker.respond({ requestId: 'request-1', allowed: false })).resolves.toBeDefined()
    await expect(result).resolves.toEqual({ allowed: false })
    expect(broker.pending()).toEqual([])
    await expect(broker.respond({ requestId: 'request-1', allowed: true })).resolves.toBeUndefined()
  })

  test('拒绝理由透传给策略层：PermissionResponse.reason 不丢失', async () => {
    const { broker } = harness()
    const result = broker.ask(writeInput(), new AbortController().signal)

    await expect(
      broker.respond({
        requestId: 'request-1',
        allowed: false,
        reason: '不要动这个文件，先看日志',
      }),
    ).resolves.toBeDefined()
    await expect(result).resolves.toEqual({
      allowed: false,
      reason: '不要动这个文件，先看日志',
    })
  })

  test('AbortSignal 中止时释放挂起（stop 清理）', async () => {
    const { broker, emitted } = harness()
    const controller = new AbortController()
    const result = broker.ask(writeInput(), controller.signal)
    expect(emitted).toHaveLength(1)

    controller.abort()

    await expect(result).resolves.toEqual({ allowed: false, reason: '操作已中止' })
    expect(broker.pending()).toEqual([])
  })

  test('已经中断的 signal 不推送 UI 且立即释放', async () => {
    const { broker, emitted } = harness()
    const controller = new AbortController()
    controller.abort()

    const result = broker.ask(writeInput(), controller.signal)

    await expect(result).resolves.toEqual({ allowed: false, reason: '操作已中止' })
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

    await expect(first).resolves.toEqual({ allowed: false, reason: '会话已结束' })
    expect(broker.pending()).toHaveLength(1)
    expect(broker.pending()[0]?.sessionId).toBe('session-2')

    broker.clearSession('session-2')
    await expect(second).resolves.toEqual({ allowed: false, reason: '会话已结束' })
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

    await broker.respond({ requestId: 'request-1', allowed: true })
    await broker.respond({ requestId: 'request-2', allowed: true })
    await Promise.all([writeResult, destructiveResult])
  })

  test('requiresModal：破坏性命令与 delete 升级模态，普通写工具仍 inline', async () => {
    const { broker, emitted } = harness()
    broker.ask(
      writeInput({
        toolName: 'bash',
        args: { command: 'rm -rf C:\\work\\cache' },
      }),
      new AbortController().signal,
    )
    broker.ask(
      writeInput({
        toolName: 'delete',
        args: { paths: ['C:\\work\\cache\\a.tmp'] },
      }),
      new AbortController().signal,
    )
    broker.ask(
      writeInput({ toolName: 'bash', args: { command: 'git status' } }),
      new AbortController().signal,
    )
    broker.ask(writeInput(), new AbortController().signal)

    expect(emitted.map((request) => request.requiresModal)).toEqual([
      true,
      true,
      false,
      false,
    ])
    // delete 与 rm 一样不可持久化：无「总是允许」候选
    expect(emitted[0]?.neverPersist).toBe(true)
    expect(emitted[0]?.suggestedGrants).toEqual([])
    expect(emitted[1]?.neverPersist).toBe(true)
    expect(emitted[1]?.suggestedGrants).toEqual([])

    for (const request of emitted) {
      await broker.respond({ requestId: request.requestId, allowed: false })
    }
    expect(broker.pending()).toEqual([])
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
    await broker.respond({ requestId: broker.pending()[0]!.requestId, allowed: true })
    await expect(decision).resolves.toEqual({ action: 'allow' })
    expect(broker.pending()).toEqual([])
  })
})
