import type { PermissionRule } from '../../shared/contracts/permission.ts'

/**
 * 权限规则持久化端口。S05 先用内存实现承载决策测试，
 * S07 换 SQLite 并补齐 add/remove。
 */
export interface PermissionRuleRepository {
  list(): PermissionRule[]
  add(rule: Omit<PermissionRule, 'createdAt' | 'hits'>): void
  remove(id: string): void
}

export class MemoryPermissionRuleRepository implements PermissionRuleRepository {
  readonly #rules: PermissionRule[]

  constructor(initial: PermissionRule[] = []) {
    this.#rules = initial.slice()
  }

  list(): PermissionRule[] {
    return this.#rules.slice()
  }

  add(rule: Omit<PermissionRule, 'createdAt' | 'hits'>): void {
    const key = ruleKey(rule)
    const existing = this.#rules.find((item) => ruleKey(item) === key)
    if (existing) return // 相同工具×范围×owner 保持幂等，不产生重复规则
    this.#rules.push({ ...rule, createdAt: Date.now(), hits: 0 })
  }

  remove(id: string): void {
    const index = this.#rules.findIndex((rule) => rule.id === id)
    if (index === -1) return
    this.#rules.splice(index, 1)
  }
}

/** 去重键：与 SQLite `UNIQUE(tool, match, pattern, scope, owner_id)` 保持一致 */
function ruleKey(rule: Pick<PermissionRule, 'tool' | 'match' | 'pattern' | 'scope' | 'ownerId'>): string {
  return JSON.stringify([
    rule.tool,
    rule.match,
    rule.pattern,
    rule.scope,
    rule.ownerId ?? '',
  ])
}
