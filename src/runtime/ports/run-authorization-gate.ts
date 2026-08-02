export interface AuthorizationTicket {
  ticketId: string
  decisionId: string
  rootRunId: string
  agentRunId: string
  runGeneration: number
  authorizationEpoch: number
  invocationFingerprint: string
  resourceIdentityHash: string
  ceilingHash: string
  mountRevision: string
  policyRevision: string
  ruleRevision: number
  expiresAt: number
}

export interface AuthorizedInvocation {
  invocationFingerprint: string
  resourceIdentityHash: string
  rootRunId: string
  agentRunId: string
  runGeneration: number
  authorizationEpoch: number
  ceilingHash: string
  mountRevision: string
  policyRevision: string
  ruleRevision: number
}

export interface ExecutionLease {
  readonly ticketId: string
  readonly claimedAt: number
}

export interface OperationHandle<T> {
  status: 'running'
  result: Promise<T>
}

export type AuthorizationRevocationReason = 'stop' | 'crash' | 'reload' | 'session_closed'

export interface RunAuthorizationGate {
  tryBeginExecution<T>(
    ticket: AuthorizationTicket,
    invocation: AuthorizedInvocation,
    begin: (lease: ExecutionLease) => OperationHandle<T>,
  ): Promise<OperationHandle<T>>
  revokeRoot(rootRunId: string, reason: AuthorizationRevocationReason): Promise<void>
}

export function authorizationCeilingHash(input: {
  workspaceId: string
  mountRevision: string
  allowedToolIds: readonly string[]
  maxAutoRisk: string
  mode: string
}): string {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    mountRevision: input.mountRevision,
    allowedToolIds: [...input.allowedToolIds].sort(),
    maxAutoRisk: input.maxAutoRisk,
    mode: input.mode,
  })
}
