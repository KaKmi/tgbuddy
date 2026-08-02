import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryDelegationRepository } from '../../../src/runtime/delegation/delegation-repository.ts'
import type { DelegationTask } from '../../../src/shared/contracts/delegation.ts'

describe('DelegationTask 持久化契约', () => {
  test('状态和 usage 使用 CAS，过期 version 不能覆盖新状态', () => {
    const repository = new MemoryDelegationRepository()
    const queued = repository.create(task())
    const starting = repository.compareAndSet(queued.id, queued.version, {
      status: 'starting',
    })
    const running = repository.compareAndSet(starting.id, starting.version, {
      status: 'running',
    })
    const withUsage = repository.appendUsage(running.id, running.version, {
      turns: 1,
      inputTokens: 20,
    })

    expect(withUsage).toMatchObject({
      status: 'running',
      version: 3,
      usage: { turns: 1, inputTokens: 20 },
    })
    expect(() => repository.compareAndSet(queued.id, queued.version, {
      status: 'completed',
    })).toThrow(/版本冲突/)
  })

  test('SQLite schema 只接受 durable lifecycle 状态', () => {
    const sql = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'src', 'infrastructure', 'sqlite', 'migrations', '023_app_delegation_tasks.sql'),
      'utf8',
    )
    expect(sql).toContain('CREATE TABLE app_delegation_tasks')
    expect(sql).not.toContain('waiting_permission')
    expect(sql).toContain('permission_ceiling_json')
  })
})

function task(): DelegationTask {
  return {
    id: 'task-1',
    rootRunId: 'root-1',
    rootSessionId: 'session-1',
    childSessionId: 'child-1',
    role: 'explorer',
    title: '分析项目',
    task: '读取项目结构并总结',
    status: 'queued',
    version: 0,
    usage: { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    permissionCeiling: {
      schemaVersion: 1,
      policyVersion: 'permission-v2',
      mode: 'auto',
      rootSessionId: 'session-1',
      workspaceId: 'workspace-1',
      mountRevision: 'mount-1',
      allowedToolIds: ['read'],
      maxAutoRisk: 'R1',
      role: 'explorer',
    },
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}
