import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeWorkspaceMountResolver } from '../../../src/infrastructure/workspace/node-workspace-mount-resolver.ts'

describe('NodeWorkspaceMountResolver', () => {
  test('存在的目录解析为可用 mount，携带 workspaceId/path/resolvedAt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-mount-ok-'))
    try {
      const directory = join(root, 'work')
      await mkdir(directory)
      const resolver = new NodeWorkspaceMountResolver(() => 1234)

      const resolution = resolver.resolve('ws-1', directory)

      expect(resolution).toEqual({
        ok: true,
        mount: {
          workspaceId: 'ws-1',
          path: directory,
          resolvedAt: 1234,
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('目录缺失时返回 missing，且每次调用都重新检查', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-mount-missing-'))
    try {
      const directory = join(root, 'gone')
      const resolver = new NodeWorkspaceMountResolver(() => 1)

      expect(resolver.resolve('ws-1', directory)).toEqual({
        ok: false,
        code: 'missing',
        path: directory,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('文件冒充目录时返回 not-directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-mount-file-'))
    try {
      const file = join(root, 'not-a-directory')
      await writeFile(file, 'content')
      const resolver = new NodeWorkspaceMountResolver(() => 1)

      expect(resolver.resolve('ws-1', file)).toEqual({
        ok: false,
        code: 'not-directory',
        path: file,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('恢复后可用：缺失目录重建后下一次 resolve 成功', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-mount-recover-'))
    try {
      const directory = join(root, 'recovered')
      const resolver = new NodeWorkspaceMountResolver(() => 2)

      expect(resolver.resolve('ws-1', directory).ok).toBe(false)
      await mkdir(directory)
      expect(resolver.resolve('ws-1', directory)).toEqual({
        ok: true,
        mount: {
          workspaceId: 'ws-1',
          path: directory,
          resolvedAt: 2,
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
