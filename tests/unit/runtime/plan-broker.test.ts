import { describe, expect, test } from 'bun:test'
import {
  createPlanAskBroker,
  type PlanAskBroker,
} from '../../../src/runtime/index.ts'
import type { PlanRequest } from '../../../src/shared/contracts/permission.ts'
import { MemoryPlanEffectRepository } from '../../../src/runtime/plans/plan-effect-repository.ts'

function harness(): {
  broker: PlanAskBroker
  emitted: PlanRequest[]
  effects: MemoryPlanEffectRepository
} {
  const emitted: PlanRequest[] = []
  let sequence = 0
  const effects = new MemoryPlanEffectRepository()
  const broker = createPlanAskBroker({
    createId: () => `plan-${++sequence}`,
    emitRequest(request) {
      emitted.push(request)
    },
    resolveSource: () => ({
      rootRunId: 'root-1', runId: 'agent-1', sessionId: 'session-1', subjectId: 'agent-1',
    }),
    commitEffects({ request, phase, source }) {
      request.effects.forEach((effect, index) => effects.add({
        rootRunId: source.rootRunId,
        planId: phase.planId,
        planRevision: phase.planRevision,
        effectId: `${phase.planId}:${index}`,
        subjectTemplate: { kind: 'root_agent', agentRunId: source.subjectId },
        maxRisk: effect.maxRisk,
        matcher: effect,
      }))
    },
  })
  return { broker, emitted, effects }
}

describe('PlanAskBroker', () => {
  test('requestApproval 登记并推送，pending 快照可恢复（重载）', async () => {
    const { broker, emitted, effects } = harness()
    const result = broker.requestApproval(
    { sessionId: 'session-1', plan: '# 计划', effects: [{ tool: 'write', match: 'path', pattern: 'C:\\work\\a.ts', maxRisk: 'R3' }] },
      new AbortController().signal,
    )

    expect(emitted).toEqual([
      { requestId: 'plan-1', sessionId: 'session-1', plan: '# 计划', effects: [{ tool: 'write', match: 'path', pattern: 'C:\\work\\a.ts', maxRisk: 'R3' }] },
    ])
    expect(broker.pending()).toHaveLength(1)

    broker.respond({ requestId: 'plan-1', approved: true })
    await expect(result).resolves.toEqual({ approved: true })
    expect(broker.pending()).toEqual([])
    expect(effects.list('root-1')).toMatchObject([{
      planId: 'plan-1',
      subjectTemplate: { kind: 'root_agent', agentRunId: 'agent-1' },
      matcher: { tool: 'write', match: 'path', pattern: 'C:\\work\\a.ts' },
    }])
  })

  test('approve/reject：批准放行，拒绝带意见返回', async () => {
    const { broker } = harness()
    const approved = broker.requestApproval(
      { sessionId: 'session-1', plan: 'p1' },
      new AbortController().signal,
    )
    broker.respond({ requestId: 'plan-1', approved: true })
    await expect(approved).resolves.toEqual({ approved: true })

    const rejected = broker.requestApproval(
      { sessionId: 'session-1', plan: 'p2' },
      new AbortController().signal,
    )
    broker.respond({
      requestId: 'plan-2',
      approved: false,
      reason: '先补数据库迁移',
    })
    await expect(rejected).resolves.toEqual({
      approved: false,
      reason: '先补数据库迁移',
    })
  })

  test('重复响应被忽略，不影响已兑现结果', async () => {
    const { broker } = harness()
    const result = broker.requestApproval(
      { sessionId: 'session-1', plan: 'p1' },
      new AbortController().signal,
    )
    expect(broker.respond({ requestId: 'plan-1', approved: true })).toBe(true)
    await expect(result).resolves.toEqual({ approved: true })
    expect(broker.respond({ requestId: 'plan-1', approved: false })).toBe(false)
  })

  test('effect 持久化失败时不结算批准请求', () => {
    const broker = createPlanAskBroker({
      createId: () => 'plan-failed',
      emitRequest: () => {},
      resolveSource: () => ({
        rootRunId: 'root-1', runId: 'agent-1', sessionId: 'session-1', subjectId: 'agent-1',
      }),
      commitEffects: () => {
        throw new Error('模拟 effect 持久化失败')
      },
    })
    void broker.requestApproval({
      sessionId: 'session-1',
      plan: '写入文件',
      effects: [{ tool: 'write', match: 'path', pattern: 'C:\\work\\a.ts', maxRisk: 'R3' }],
    })

    expect(() => broker.respond({ requestId: 'plan-failed', approved: true }))
      .toThrow('模拟 effect 持久化失败')
    expect(broker.pending()).toHaveLength(1)
    expect(broker.phase('session-1')).toEqual({
      status: 'plan_pending', planId: 'plan-failed', planRevision: 1,
    })
  })

  test('stop（AbortSignal）与 clearSession 释放挂起审批', async () => {
    const { broker } = harness()
    const controller = new AbortController()
    const aborted = broker.requestApproval(
      { sessionId: 'session-1', plan: 'p1' },
      controller.signal,
    )
    controller.abort()
    await expect(aborted).resolves.toEqual({ approved: false, reason: '操作已中止' })

    const discarded = broker.requestApproval(
      { sessionId: 'session-2', plan: 'p2' },
      new AbortController().signal,
    )
    broker.clearSession('session-2')
    await expect(discarded).resolves.toEqual({ approved: false, reason: '会话已结束' })
    expect(broker.pending()).toEqual([])
  })
})
