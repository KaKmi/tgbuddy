/**
 * D01：单层 child 委派策略（docs/02 2.4）。
 * - 每个 root 最多 2 个 child，最大深度 1，失败也消耗名额；
 * - token 总预算：root 及其 child 合计超限后拒绝继续委派。
 */
export const MAX_CHILDREN_PER_ROOT = 2
export const MAX_DEPTH = 1
export const ROOT_TOKEN_BUDGET = 20_000_000

export interface DelegationDecision {
  ok: boolean
  reason?: string
}

export interface DelegationPolicyContext {
  /** 该 root 已创建的 child 数（失败也计入） */
  childCount: number
  activeCount?: number
  depth?: number
  /** 该 root 全部 run（含自身）已用 token 合计 */
  usedTokens: number
}

export function canDelegate(
  context: DelegationPolicyContext,
): DelegationDecision {
  if ((context.depth ?? 0) >= MAX_DEPTH) {
    return { ok: false, reason: '子智能体不能再次委派' }
  }
  if ((context.activeCount ?? 0) >= 1) {
    return { ok: false, reason: '已有子智能体正在执行，请等待完成后再委派' }
  }
  if (context.childCount >= MAX_CHILDREN_PER_ROOT) {
    return {
      ok: false,
      reason: `每个任务最多委派 ${MAX_CHILDREN_PER_ROOT} 个子智能体，已达到上限`,
    }
  }
  if (context.usedTokens >= ROOT_TOKEN_BUDGET) {
    return {
      ok: false,
      reason: '任务 token 预算已用完，无法再委派子智能体',
    }
  }
  return { ok: true }
}
