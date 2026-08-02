import type {
  AuthorizationTicket,
  AuthorizedInvocation,
  RunAuthorizationGate,
} from '../ports/run-authorization-gate.ts'
export * from '../ports/run-authorization-gate.ts'

export class AuthorizationGateError extends Error {
  constructor(readonly code: 'authorization_stale' | 'authorization_replayed' | 'authorization_revoked') {
    super(code)
  }
}

export function createRunAuthorizationGate(now: () => number = Date.now): RunAuthorizationGate {
  const claims = new Set<string>()
  const revokedRoots = new Set<string>()
  return {
    async tryBeginExecution(ticket, current, begin) {
      if (revokedRoots.has(ticket.rootRunId)) throw new AuthorizationGateError('authorization_revoked')
      if (claims.has(ticket.ticketId)) throw new AuthorizationGateError('authorization_replayed')
      if (!ticketMatches(ticket, current, now())) throw new AuthorizationGateError('authorization_stale')
      claims.add(ticket.ticketId)
      return begin(Object.freeze({ ticketId: ticket.ticketId, claimedAt: now() }))
    },
    async revokeRoot(rootRunId) {
      revokedRoots.add(rootRunId)
    },
  }
}

function ticketMatches(ticket: AuthorizationTicket, current: AuthorizedInvocation, now: number): boolean {
  return ticket.expiresAt >= now
    && ticket.rootRunId === current.rootRunId
    && ticket.agentRunId === current.agentRunId
    && ticket.runGeneration === current.runGeneration
    && ticket.authorizationEpoch === current.authorizationEpoch
    && ticket.invocationFingerprint === current.invocationFingerprint
    && ticket.resourceIdentityHash === current.resourceIdentityHash
    && ticket.ceilingHash === current.ceilingHash
    && ticket.mountRevision === current.mountRevision
    && ticket.policyRevision === current.policyRevision
    && ticket.ruleRevision === current.ruleRevision
}
