import type { PlanEffectGrant } from '../../../shared/contracts/permission.ts'
import type { PlanEffectRepository } from '../../../runtime/plans/plan-effect-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface PlanEffectRow {
  effect_id: string
  root_run_id: string
  plan_id: string
  plan_revision: number
  subject_json: string
  matcher_json: string
  max_risk: PlanEffectGrant['maxRisk']
}

export class SqlitePlanEffectRepository implements PlanEffectRepository {
  constructor(private readonly database: AppDatabase) {}

  add(grant: PlanEffectGrant): void {
    this.database.use((db) => db.prepare(
      `INSERT OR REPLACE INTO app_plan_effects (
        effect_id, root_run_id, plan_id, plan_revision, subject_json,
        matcher_json, max_risk, resource_identity_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', NULL, ?)`,
    ).run(
      grant.effectId,
      grant.rootRunId,
      grant.planId,
      grant.planRevision,
      JSON.stringify(grant.subjectTemplate),
      JSON.stringify(grant.matcher),
      grant.maxRisk,
      Date.now(),
    ))
  }

  list(rootRunId: string): PlanEffectGrant[] {
    return this.database.use((db) => {
      const rows = db.prepare(
        `SELECT effect_id, root_run_id, plan_id, plan_revision,
                subject_json, matcher_json, max_risk
         FROM app_plan_effects WHERE root_run_id = ? ORDER BY created_at, effect_id`,
      ).all(rootRunId) as unknown as PlanEffectRow[]
      return rows.map((row) => ({
        effectId: row.effect_id,
        rootRunId: row.root_run_id,
        planId: row.plan_id,
        planRevision: row.plan_revision,
        subjectTemplate: JSON.parse(row.subject_json) as PlanEffectGrant['subjectTemplate'],
        matcher: JSON.parse(row.matcher_json) as PlanEffectGrant['matcher'],
        maxRisk: row.max_risk,
      }))
    })
  }

  removePlan(rootRunId: string, planId: string): void {
    this.database.use((db) => {
      db.prepare('DELETE FROM app_plan_effects WHERE root_run_id = ? AND plan_id = ?')
        .run(rootRunId, planId)
    })
  }

  removeRoot(rootRunId: string): void {
    this.database.use((db) => {
      db.prepare('DELETE FROM app_plan_effects WHERE root_run_id = ?').run(rootRunId)
    })
  }
}
