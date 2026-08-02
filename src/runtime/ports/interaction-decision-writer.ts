import type {
  PermissionRequest,
  PermissionResponse,
  PermissionRule,
} from '../../shared/contracts/permission.ts'

export type PermissionExecutionState =
  | 'accepted_not_executed'
  | 'execution_claimed'
  | 'completed'
  | 'failed'

export type InteractionDecisionCommit =
  | {
      kind: 'permission'
      request: PermissionRequest
      response: PermissionResponse
      responseHash: string
      rule?: Omit<PermissionRule, 'createdAt' | 'hits'>
    }
  | { kind: 'plan'; requestId: string; responseHash: string; payload: unknown }
  | { kind: 'ask_user'; requestId: string; responseHash: string; payload: unknown }

export interface InteractionDecisionReceipt {
  status: 'committed'
  requestId: string
  decisionId: string
  responseHash: string
  kind: InteractionDecisionCommit['kind']
  executionState?: PermissionExecutionState
}

export interface InteractionDecisionWriter {
  commit(input: InteractionDecisionCommit): Promise<InteractionDecisionReceipt>
  findReceipt(requestId: string): InteractionDecisionReceipt | undefined
}

export class InteractionResponseConflictError extends Error {
  readonly code = 'interaction_response_conflict'

  constructor(requestId: string) {
    super(`人机请求 ${requestId} 已提交不同响应`)
  }
}

export function interactionResponseHash(response: unknown): string {
  return stableSerialize(response)
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(',')}}`
}
