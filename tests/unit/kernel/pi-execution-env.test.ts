import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiRunExecutionEnvFactory } from '../../../src/kernel/pi/pi-execution-env.ts'

describe('PiRunExecutionEnv', () => {
  test('每个 Run 独立 env：两个工作区并行写入互不串目录', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'tgbuddy-env-a-'))
    const rootB = await mkdtemp(join(tmpdir(), 'tgbuddy-env-b-'))
    try {
      const factory = new PiRunExecutionEnvFactory()
      const envA = factory.create({ workspaceId: 'ws-a', mountPath: rootA })
      const envB = factory.create({ workspaceId: 'ws-b', mountPath: rootB })

      expect(envA.workspaceId).toBe('ws-a')
      expect(envB.workspaceId).toBe('ws-b')
      expect(envA.id).not.toBe(envB.id)

      expect((await envA.env.writeFile('report.txt', 'A')).ok).toBe(true)
      expect(await envB.env.exists('report.txt')).toEqual({
        ok: true,
        value: false,
      })
      expect(await readFile(join(rootA, 'report.txt'), 'utf8')).toBe('A')

      expect((await envB.env.writeFile('report.txt', 'B')).ok).toBe(true)
      expect(await readFile(join(rootB, 'report.txt'), 'utf8')).toBe('B')
      expect(await readFile(join(rootA, 'report.txt'), 'utf8')).toBe('A')
    } finally {
      await Promise.all([rm(rootA, { recursive: true, force: true }), rm(rootB, { recursive: true, force: true })])
    }
  })

  test('越界写入在 env 层被拒绝，错误可见为 PermissionDenied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-env-deny-'))
    try {
      const factory = new PiRunExecutionEnvFactory()
      const env = factory.create({ workspaceId: 'ws-a', mountPath: root })

      const result = await env.env.writeFile('../outside.txt', 'x')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('PermissionDenied')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('dispose 幂等释放 env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-env-dispose-'))
    try {
      const factory = new PiRunExecutionEnvFactory()
      const env = factory.create({ workspaceId: 'ws-a', mountPath: root })

      await env.dispose()
      expect(env.disposed).toBe(true)
      await expect(env.dispose()).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
