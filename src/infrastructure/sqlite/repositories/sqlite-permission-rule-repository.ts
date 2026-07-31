import type { PermissionRule } from '../../../shared/contracts/permission.ts'
import type { PermissionRuleRepository } from '../../../runtime/permissions/permission-rule-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface PermissionRuleRow {
  id: string
  tool: string
  match: PermissionRule['match']
  pattern: string
  action: NonNullable<PermissionRule['action']>
  scope: PermissionRule['scope']
  never_persist: number
  owner_id: string
  source: NonNullable<PermissionRule['source']>
  reason: string | null
  created_at: number
  hits: number
}

const SELECT_COLUMNS = `
  id,
  tool,
  match,
  pattern,
  action,
  scope,
  never_persist,
  owner_id,
  source,
  reason,
  created_at,
  hits
`

function rowToRule(row: PermissionRuleRow): PermissionRule {
  return {
    id: row.id,
    tool: row.tool,
    match: row.match,
    pattern: row.pattern,
    ...(row.action === 'allow' ? {} : { action: row.action }),
    scope: row.scope,
    neverPersist: row.never_persist === 1,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    source: row.source,
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: row.created_at,
    hits: row.hits,
  }
}

/**
 * `app_permission_rules` 的 SQLite adapter。与其它 app 表共用同一个
 * AppDatabase 连接，规则是用户「总是允许」攒出来的资产，跨重启保留。
 */
export class SqlitePermissionRuleRepository implements PermissionRuleRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(): PermissionRule[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_permission_rules ORDER BY created_at ASC, id ASC`)
        .all() as unknown as PermissionRuleRow[]
      return rows.map(rowToRule)
    })
  }

  add(rule: Omit<PermissionRule, 'createdAt' | 'hits'>): void {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_permission_rules (
             id, tool, match, pattern, action, scope, never_persist,
             owner_id, source, reason, created_at, hits
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT (tool, match, pattern, scope, owner_id) DO NOTHING`,
        )
        .run(
          rule.id,
          rule.tool,
          rule.match,
          rule.pattern,
          rule.action ?? 'allow',
          rule.scope,
          rule.neverPersist ? 1 : 0,
          rule.ownerId ?? '',
          rule.source ?? 'user',
          rule.reason ?? null,
          Date.now(),
        )
    })
  }

  remove(id: string): void {
    this.#appDatabase.use((database) => {
      database.prepare('DELETE FROM app_permission_rules WHERE id = ?').run(id)
    })
  }
}
