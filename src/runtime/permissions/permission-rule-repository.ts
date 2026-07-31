import type { PermissionRule } from '../../shared/contracts/permission.ts'

/**
 * 权限规则持久化端口。S05 先用内存实现承载决策测试，
 * S07 换 SQLite 并补齐 add/remove。
 */
export interface PermissionRuleRepository {
  list(): PermissionRule[]
}

export class MemoryPermissionRuleRepository implements PermissionRuleRepository {
  readonly #rules: PermissionRule[]

  constructor(initial: PermissionRule[] = []) {
    this.#rules = initial.slice()
  }

  list(): PermissionRule[] {
    return this.#rules.slice()
  }
}
