import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PiProcessIdentityBinder } from '../../../src/kernel/pi/pi-process-identity-binder.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Shell 授权资源身份', () => {
  test('批准后替换 executable 会拒绝 spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-process-auth-'))
    roots.push(root)
    const executable = join(root, process.platform === 'win32' ? 'tool.cmd' : 'tool')
    await writeFile(executable, process.platform === 'win32' ? '@echo ok' : '#!/bin/sh\necho ok')
    if (process.platform !== 'win32') await chmod(executable, 0o755)
    const invocation = {
      kind: 'shell',
      shell: { tokens: [executable, '--scan'], canonicalCwd: root, redirected: false },
    }
    const binder = new PiProcessIdentityBinder()
    const binding = await binder.bind(invocation)

    await rename(executable, `${executable}.old`)
    await writeFile(executable, process.platform === 'win32' ? '@echo changed' : '#!/bin/sh\necho changed')

    await expect(binder.verify(invocation, binding)).rejects.toMatchObject({
      code: 'resource_identity_changed',
    })
  })
})
