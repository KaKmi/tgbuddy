import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PiFileIdentityBinder } from '../../../src/kernel/pi/pi-file-identity-binder.ts'
import type { ResolvedInvocation } from '../../../src/runtime/permissions/invocation-normalizer.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('文件授权资源身份', () => {
  test('搜索工作区根目录可以绑定并核验', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-file-auth-'))
    roots.push(root)
    const binder = await PiFileIdentityBinder.create(root, 'mount-1')
    const binding = await binder.bind({
      kind: 'file',
      file: { paths: [{ canonicalPath: root }] },
    })

    await expect(binder.verify(binding)).resolves.toBeUndefined()
  })

  test('授权后替换父目录会拒绝执行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-file-auth-'))
    roots.push(root)
    const safe = join(root, 'safe')
    const target = join(safe, 'report.md')
    await mkdir(safe)
    const binder = await PiFileIdentityBinder.create(root, 'mount-1')
    const binding = await binder.bind(fileInvocation(target, 'missing'))

    await rename(safe, join(root, 'old-safe'))
    await mkdir(safe)

    await expect(binder.verify(binding)).rejects.toMatchObject({
      code: 'resource_identity_changed',
    })
  })

  test('未变化的已有文件可以继续执行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-file-auth-'))
    roots.push(root)
    const target = join(root, 'report.md')
    await writeFile(target, 'ok')
    const binder = await PiFileIdentityBinder.create(root, 'mount-1')
    const binding = await binder.bind(fileInvocation(target, 'file'))

    await expect(binder.verify(binding)).resolves.toBeUndefined()
  })
})

function fileInvocation(path: string, kind: 'file' | 'missing'): ResolvedInvocation {
  return {
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    toolName: 'write',
    args: { path },
    kind: 'file',
    targets: [{ kind: 'path', value: path }],
    fingerprint: 'fingerprint',
    resourceIdentityHash: 'resource',
    file: {
      operation: 'write',
      paths: [{ kind, canonicalPath: path, identityHash: 'identity', scope: 'workspace' }],
    },
  }
}
