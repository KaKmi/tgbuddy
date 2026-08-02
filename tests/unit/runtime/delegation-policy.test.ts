import { describe, expect, test } from 'bun:test'
import {
  canDelegate,
  MAX_CHILDREN_PER_ROOT,
  ROOT_TOKEN_BUDGET,
} from '../../../src/runtime/delegation/delegation-policy.ts'

describe('canDelegate（D01）', () => {
  test('未达上限且预算充足时放行', () => {
    expect(canDelegate({ childCount: 0, usedTokens: 0 })).toEqual({ ok: true })
  })

  test('child 数达到上限拒绝（失败也计入，正好满 2 个时拒绝第 3 个）', () => {
    const decision = canDelegate({
      childCount: MAX_CHILDREN_PER_ROOT,
      usedTokens: 0,
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('最多委派 2 个')
  })

  test('token 预算耗尽拒绝并给出原因', () => {
    const decision = canDelegate({
      childCount: 1,
      usedTokens: ROOT_TOKEN_BUDGET,
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('预算')
  })
})
