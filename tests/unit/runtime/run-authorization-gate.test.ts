import { describe, expect, test } from 'bun:test'
import {
  createRunAuthorizationGate,
  type AuthorizationTicket,
  type AuthorizedInvocation,
} from '../../../src/runtime/permissions/run-authorization-gate.ts'

function ticket(overrides: Partial<AuthorizationTicket> = {}): AuthorizationTicket {
  return {
    ticketId: 'ticket-1',
    decisionId: 'decision-1',
    rootRunId: 'root-1',
    agentRunId: 'run-1',
    runGeneration: 3,
    authorizationEpoch: 1,
    invocationFingerprint: 'fp-1',
    resourceIdentityHash: 'resource-1',
    ceilingHash: 'ceiling-1',
    mountRevision: 'mount-1',
    policyRevision: 'permission-v2',
    ruleRevision: 1,
    expiresAt: 2_000,
    ...overrides,
  }
}

function invocation(fingerprint: string): AuthorizedInvocation {
  return {
    invocationFingerprint: fingerprint,
    resourceIdentityHash: 'resource-1',
    rootRunId: 'root-1',
    agentRunId: 'run-1',
    runGeneration: 3,
    authorizationEpoch: 1,
    ceilingHash: 'ceiling-1',
    mountRevision: 'mount-1',
    policyRevision: 'permission-v2',
    ruleRevision: 1,
  }
}

describe('RunAuthorizationGate', () => {
  test('票据只可 claim 一次，fingerprint 变化时拒绝执行', async () => {
    const gate = createRunAuthorizationGate(() => 1_000)
    let starts = 0
    const begin = () => {
      starts++
      return { status: 'running' as const, result: Promise.resolve('ok') }
    }
    await expect(gate.tryBeginExecution(ticket(), invocation('fp-2'), begin))
      .rejects.toMatchObject({ code: 'authorization_stale' })
    await expect(gate.tryBeginExecution(ticket(), invocation('fp-1'), begin))
      .resolves.toMatchObject({ status: 'running' })
    await expect(gate.tryBeginExecution(ticket(), invocation('fp-1'), begin))
      .rejects.toMatchObject({ code: 'authorization_replayed' })
    expect(starts).toBe(1)
  })
})
