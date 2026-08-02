import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  createSandboxPathContext,
  resolveSandboxedPath,
  SandboxPathError,
  type SandboxPathContext,
} from '../../../src/kernel/pi/pi-sandbox.ts'

describe('resolveSandboxedPath', () => {
  test('工作区内的相对路径解析到 mount 根', () => {
    const context = createSandboxPathContext('C:\\work')
    expect(resolveSandboxedPath('docs/a.md', context)).toBe('C:\\work\\docs\\a.md')
  })

  test('`..` 逃逸被拒绝', () => {
    const context = createSandboxPathContext('C:\\work')
    expect(() => resolveSandboxedPath('../secret', context)).toThrow(
      SandboxPathError,
    )
  })

  test('mount 内的绝对路径允许', () => {
    const context = createSandboxPathContext('C:\\work')
    expect(resolveSandboxedPath('C:\\work\\a.md', context)).toBe(
      'C:\\work\\a.md',
    )
  })

  test('mount 外的绝对路径被拒绝', () => {
    const context = createSandboxPathContext('C:\\work')
    expect(() => resolveSandboxedPath('C:\\other\\a.md', context)).toThrow(
      SandboxPathError,
    )
  })

  test('~ 展开后再做 containment：mount 在家目录时合法，mount 在别处时拒绝', () => {
    const home = homedir()
    const homeContext = createSandboxPathContext(home)
    expect(resolveSandboxedPath('~/notes.md', homeContext)).toBe(
      resolve(home, 'notes.md'),
    )
    expect(() => resolveSandboxedPath('~/notes.md', createSandboxPathContext('C:\\work'))).toThrow(
      SandboxPathError,
    )
  })

  test('黑名单目录（~/.tgbuddy）优先于更具体的挂载白名单', () => {
    const mount = resolve(homedir(), '.tgbuddy', 'workspaces', 'w1')
    const context = createSandboxPathContext(mount)
    expect(
      resolveSandboxedPath(resolve(mount, 'readme.md'), context),
    ).toContain(mount)
    expect(
      () => resolveSandboxedPath(resolve(homedir(), '.tgbuddy', 'sessions'), context),
    ).toThrow(SandboxPathError)
  })

  test('尚不存在的深层子路径按最近已存在祖先规范化后仍允许', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-path-deep-'))
    try {
      const context = createSandboxPathContext(root)
      const deep = join(root, 'new', 'nested', 'file.md')
      expect(resolveSandboxedPath(deep, context)).toBe(
        join(root, 'new', 'nested', 'file.md'),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('大小写不同的 mount 内路径通过 realpath 归一后允许', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-path-case-'))
    try {
      await mkdir(join(root, 'Sub'))
      await writeFile(join(root, 'Sub', 'File.md'), 'x')
      const context = createSandboxPathContext(root)
      const mixedCase = join(root, 'sub', 'file.MD')
      // Windows realpath 不一定改写大小写，但 containment 必须大小写不敏感：
      // 大小写不同的合法路径不能被误拒。
      expect(() => resolveSandboxedPath(mixedCase, context)).not.toThrow()
      const resolved = resolveSandboxedPath(mixedCase, context)
      expect(relative(context.root, resolved)).not.toMatch(/^\.\.[\\/]/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('junction/symlink 逃逸被拒绝：链接指向 mount 外', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-path-link-'))
    const outside = join(root, 'outside-secret')
    try {
      await mkdir(outside)
      const link = join(root, 'work', 'escape')
      await mkdir(join(root, 'work'), { recursive: true })
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
      const context = createSandboxPathContext(join(root, 'work'))

      expect(() => resolveSandboxedPath('escape/secret.txt', context)).toThrow(
        SandboxPathError,
      )
      expect(() => resolveSandboxedPath('escape', context)).toThrow(
        SandboxPathError,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('指向 mount 内的 junction 允许', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-path-linkin-'))
    try {
      const inside = join(root, 'work', 'real')
      await mkdir(inside, { recursive: true })
      const link = join(root, 'work', 'alias')
      await symlink(inside, link, process.platform === 'win32' ? 'junction' : 'dir')
      const context = createSandboxPathContext(join(root, 'work'))

      expect(resolveSandboxedPath('alias/doc.md', context)).toBe(
        join(inside, 'doc.md'),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
