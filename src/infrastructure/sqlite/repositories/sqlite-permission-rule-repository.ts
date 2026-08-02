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
  revision: number
  enabled: number
  needs_review: number
  created_by_subject: string
  max_applicable_scope: PermissionRule['scope']
  last_hit_at: number | null
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
  hits,
  revision,
  enabled,
  needs_review,
  created_by_subject,
  max_applicable_scope,
  last_hit_at
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
    revision: row.revision,
    enabled: row.enabled === 1,
    needsReview: row.needs_review === 1,
    ...(row.created_by_subject ? { createdBySubject: row.created_by_subject } : {}),
    maxApplicableScope: row.max_applicable_scope,
    ...(row.last_hit_at !== null ? { lastHitAt: row.last_hit_at } : {}),
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
             id, tool, match, pattern, matcher_json, action, scope, never_persist,
             owner_id, source, reason, revision, enabled, needs_review,
             created_by_subject, max_applicable_scope, created_at, hits, last_hit_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT (tool, match, pattern, scope, owner_id) DO NOTHING`,
        )
        .run(
          rule.id,
          rule.tool,
          rule.match,
          rule.pattern,
          JSON.stringify({ match: rule.match, pattern: rule.pattern }),
          rule.action ?? 'allow',
          rule.scope,
          rule.neverPersist ? 1 : 0,
          rule.ownerId ?? '',
          rule.source ?? 'user',
          rule.reason ?? null,
          rule.revision ?? 1,
          rule.enabled === false ? 0 : 1,
          rule.needsReview ? 1 : 0,
          rule.createdBySubject ?? '',
          rule.maxApplicableScope ?? rule.scope,
          Date.now(),
          rule.lastHitAt ?? null,
        )
    })
  }

  remove(id: string): void {
    this.#appDatabase.use((database) => {
      database.prepare('DELETE FROM app_permission_rules WHERE id = ?').run(id)
    })
  }
}
