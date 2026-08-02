import type { PermissionRule } from '../../../shared/contracts/permission.ts'
import {
  InteractionResponseConflictError,
  type InteractionDecisionCommit,
  type InteractionDecisionReceipt,
  type InteractionDecisionWriter,
} from '../../../runtime/ports/interaction-decision-writer.ts'
import type { AppDatabase } from '../app-database.ts'

interface DecisionRow {
  request_id: string
  decision_id: string
  kind: InteractionDecisionReceipt['kind']
  response_hash: string
  execution_state: InteractionDecisionReceipt['executionState'] | null
}

export interface SqliteInteractionDecisionWriterOptions {
  createId(): string
  now(): number
  onPermissionRuleCommitted?(): void
}

export class SqliteInteractionDecisionWriter implements InteractionDecisionWriter {
  constructor(
    private readonly database: AppDatabase,
    private readonly options: SqliteInteractionDecisionWriterOptions,
  ) {}

  commit(input: InteractionDecisionCommit): Promise<InteractionDecisionReceipt> {
    const existing = this.findReceipt(requestId(input))
    if (existing) {
      if (existing.responseHash !== input.responseHash) {
        return Promise.reject(new InteractionResponseConflictError(existing.requestId))
      }
      return Promise.resolve(existing)
    }

    const decisionId = this.options.createId()
    const createdAt = this.options.now()
    const executionState = input.kind === 'permission'
      ? (input.response.allowed ? 'accepted_not_executed' : 'completed')
      : undefined
    try {
      this.database.use((db) => {
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare(
            `INSERT INTO app_interaction_decisions (
              request_id, decision_id, kind, response_hash, response_json,
              execution_state, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            requestId(input),
            decisionId,
            input.kind,
            input.responseHash,
            JSON.stringify(input),
            executionState ?? null,
            createdAt,
          )
          if (input.kind === 'permission') {
            db.prepare(
              `INSERT INTO app_permission_audit (
                decision_id, request_id, session_id, tool_call_id,
                tool_name, allowed, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              decisionId,
              input.request.requestId,
              input.request.sessionId,
              input.request.toolCallId,
              input.request.toolName,
              input.response.allowed ? 1 : 0,
              createdAt,
            )
            if (input.rule) insertRule(db, input.rule, createdAt)
          }
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      })
    } catch (error) {
      const recovered = this.findReceipt(requestId(input))
      if (recovered?.responseHash === input.responseHash) return Promise.resolve(recovered)
      return Promise.reject(error)
    }
    if (input.kind === 'permission' && input.rule) {
      this.options.onPermissionRuleCommitted?.()
    }
    return Promise.resolve({
      status: 'committed',
      requestId: requestId(input),
      decisionId,
      responseHash: input.responseHash,
      kind: input.kind,
      ...(executionState ? { executionState } : {}),
    })
  }

  findReceipt(requestId: string): InteractionDecisionReceipt | undefined {
    return this.database.use((db) => {
      const row = db.prepare(
        `SELECT request_id, decision_id, kind, response_hash, execution_state
         FROM app_interaction_decisions WHERE request_id = ?`,
      ).get(requestId) as unknown as DecisionRow | undefined
      return row ? {
        status: 'committed',
        requestId: row.request_id,
        decisionId: row.decision_id,
        responseHash: row.response_hash,
        kind: row.kind,
        ...(row.execution_state ? { executionState: row.execution_state } : {}),
      } : undefined
    })
  }
}

function requestId(input: InteractionDecisionCommit): string {
  return input.kind === 'permission' ? input.request.requestId : input.requestId
}

function insertRule(
  db: Parameters<AppDatabase['use']>[0] extends (database: infer T) => unknown ? T : never,
  rule: Omit<PermissionRule, 'createdAt' | 'hits'>,
  createdAt: number,
): void {
  db.prepare(
    `INSERT INTO app_permission_rules (
      id, tool, match, pattern, matcher_json, action, scope, never_persist,
      owner_id, source, reason, revision, enabled, needs_review,
      created_by_subject, max_applicable_scope, created_at, hits, last_hit_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
    ON CONFLICT (tool, match, pattern, scope, owner_id) DO NOTHING`,
  ).run(
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
    createdAt,
  )
}
