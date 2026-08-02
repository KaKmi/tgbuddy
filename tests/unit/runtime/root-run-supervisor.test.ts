import { describe, expect, test } from 'bun:test'
import { MemoryDelegationRepository } from '../../../src/runtime/delegation/delegation-repository.ts'
import { createRootRunSupervisor } from '../../../src/runtime/runs/root-run-supervisor.ts'
import type { DelegationTask } from '../../../src/shared/contracts/delegation.ts'

describe('RootRunSupervisor', () => {
  test('预算终止 root，并撤销该 root 的授权', async () => {
    const revoked: string[] = []
    const supervisor = createRootRunSupervisor({
      tasks: new MemoryDelegationRepository(),
      authorizationGate: {
        tryBeginExecution: async () => { throw new Error('未使用') },
        revokeRoot: async (rootRunId) => { revoked.push(rootRunId) },
      },
      maxTurns: 2,
      now: () => 10,
    })
    const signal = supervisor.startRoot('root-1')
    supervisor.consume('root-1', { turns: 1, tokens: 10 })
    expect(() => supervisor.consume('root-1', { turns: 1, tokens: 10 })).toThrow(/预算/)
    expect(signal.aborted).toBe(true)
    await supervisor.stopRoot('root-1')
    expect(revoked).toEqual(['root-1'])
  })

  test('重启把活跃子任务恢复为 interrupted', () => {
    const tasks = new MemoryDelegationRepository()
    tasks.create(task('running'))
    const supervisor = createRootRunSupervisor({
      tasks,
      authorizationGate: {
        tryBeginExecution: async () => { throw new Error('未使用') },
        revokeRoot: async () => {},
      },
      now: () => 20,
    })
    expect(supervisor.recover()).toBe(1)
    expect(tasks.get('task-1')).toMatchObject({
      status: 'interrupted',
      errorCode: 'app_restarted',
    })
  })
})

function task(status: DelegationTask['status']): DelegationTask {
  return {
    id: 'task-1', rootRunId: 'root-1', rootSessionId: 'session-1', childSessionId: 'child-1',
    role: 'explorer', title: '探索', task: '探索项目', status, version: 0,
    usage: { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    permissionCeiling: {
      schemaVersion: 1, policyVersion: 'permission-v2', mode: 'auto', rootSessionId: 'session-1',
      workspaceId: 'workspace-1', mountRevision: 'mount-1', allowedToolIds: ['read'], maxAutoRisk: 'R1', role: 'explorer',
    },
    lastActivityAt: 1, createdAt: 1, updatedAt: 1,
  }
}
