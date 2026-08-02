import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
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

  test('pi 临时文件协议走工作区内目录：createTempFile 可 append/read，dispose 后清理', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-env-temp-'))
    try {
      const factory = new PiRunExecutionEnvFactory()
      const env = factory.create({ workspaceId: 'ws-a', mountPath: root })

      const dirResult = await env.env.createTempDir('prefix-')
      expect(dirResult.ok).toBe(true)
      if (dirResult.ok) {
        expect(dirResult.value.startsWith(join(root, '.tgbuddy-tmp'))).toBe(true)
      }

      const fileResult = await env.env.createTempFile({ prefix: 'bash-', suffix: '.log' })
      expect(fileResult.ok).toBe(true)
      if (!fileResult.ok) throw new Error('createTempFile 失败')
      expect(fileResult.value.startsWith(join(root, '.tgbuddy-tmp'))).toBe(true)

      // 模拟 pi 内置 bash 工具的长输出协议：createTempFile -> appendFile -> readTextFile
      expect((await env.env.appendFile(fileResult.value, 'tail-content')).ok).toBe(true)
      const read = await env.env.readTextFile(fileResult.value)
      expect(read.ok).toBe(true)
      if (read.ok) expect(read.value).toBe('tail-content')

      await env.dispose()
      // 每个 Run 只清理自己的临时目录，避免并行其他 Run 的临时文件被误删
      expect(existsSync(join(root, '.tgbuddy-tmp', env.id))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('通过 junction/symlink 逃逸的写入在 env 层被拒绝', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-env-link-'))
    const outside = join(root, 'outside-secret')
    try {
      await mkdir(outside)
      await mkdir(join(root, 'work'), { recursive: true })
      await symlink(
        outside,
        join(root, 'work', 'escape'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const factory = new PiRunExecutionEnvFactory()
      const env = factory.create({
        workspaceId: 'ws-a',
        mountPath: join(root, 'work'),
      })

      const result = await env.env.writeFile('escape/stolen.txt', 'x')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('PermissionDenied')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
