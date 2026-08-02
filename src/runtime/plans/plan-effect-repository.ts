import type { PlanEffectGrant } from '../../shared/contracts/permission.ts'

export interface PlanEffectRepository {
  add(grant: PlanEffectGrant): void
  list(rootRunId: string): PlanEffectGrant[]
  removePlan(rootRunId: string, planId: string): void
}

export class MemoryPlanEffectRepository implements PlanEffectRepository {
  readonly #grants = new Map<string, PlanEffectGrant>()

  add(grant: PlanEffectGrant): void {
    this.#grants.set(grant.effectId, structuredClone(grant))
  }

  list(rootRunId: string): PlanEffectGrant[] {
    return [...this.#grants.values()]
      .filter((grant) => grant.rootRunId === rootRunId)
      .map((grant) => structuredClone(grant))
  }

  removePlan(rootRunId: string, planId: string): void {
    for (const [effectId, grant] of this.#grants) {
      if (grant.rootRunId === rootRunId && grant.planId === planId) {
        this.#grants.delete(effectId)
      }
    }
  }
}
