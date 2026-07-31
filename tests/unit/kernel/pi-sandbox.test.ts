import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  resolveSandboxedPath,
  SandboxPathError,
} from '../../../src/kernel/pi/pi-sandbox.ts'

describe('resolveSandboxedPath', () => {
  test('工作区内的相对路径解析到 mount 根', () => {
    expect(resolveSandboxedPath('docs/a.md', 'C:\\work')).toBe(
      'C:\\work\\docs\\a.md',
    )
  })

  test('`..` 逃逸被拒绝', () => {
    expect(() => resolveSandboxedPath('../secret', 'C:\\work')).toThrow(
      SandboxPathError,
    )
  })

  test('mount 内的绝对路径允许', () => {
    expect(resolveSandboxedPath('C:\\work\\a.md', 'C:\\work')).toBe(
      'C:\\work\\a.md',
    )
  })

  test('mount 外的绝对路径被拒绝', () => {
    expect(() => resolveSandboxedPath('C:\\other\\a.md', 'C:\\work')).toThrow(
      SandboxPathError,
    )
  })

  test('~ 展开后再做 containment：mount 在家目录时合法，mount 在别处时拒绝', () => {
    const home = homedir()
    expect(resolveSandboxedPath('~/notes.md', home)).toBe(
      resolve(home, 'notes.md'),
    )
    expect(() => resolveSandboxedPath('~/notes.md', 'C:\\work')).toThrow(
      SandboxPathError,
    )
  })

  test('黑名单目录（~/.tgbuddy）优先于更具体的挂载白名单', () => {
    const mount = resolve(homedir(), '.tgbuddy', 'workspaces', 'w1')
    expect(
      resolveSandboxedPath(resolve(mount, 'readme.md'), mount),
    ).toContain(mount)
    expect(
      () => resolveSandboxedPath(resolve(homedir(), '.tgbuddy', 'sessions'), mount),
    ).toThrow(SandboxPathError)
  })
})
