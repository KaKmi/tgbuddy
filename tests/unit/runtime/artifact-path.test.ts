import { describe, expect, test } from 'bun:test'
import { resolveArtifactInsideMount } from '../../../src/main/artifact-path.ts'

const MOUNT = 'C:\\workspaces\\A'

describe('resolveArtifactInsideMount（A07 路径逃逸）', () => {
  test('相对路径拼到 mount 内', () => {
    expect(resolveArtifactInsideMount(MOUNT, 'report.md')).toBe(
      'C:\\workspaces\\A\\report.md',
    )
  })

  test('mount 内绝对路径放行', () => {
    expect(resolveArtifactInsideMount(MOUNT, 'C:\\workspaces\\A\\a.md')).toBe(
      'C:\\workspaces\\A\\a.md',
    )
  })

  test('.. 逃逸到 mount 外被拒绝', () => {
    expect(resolveArtifactInsideMount(MOUNT, '..\\secret.md')).toBeUndefined()
    expect(resolveArtifactInsideMount(MOUNT, '..\\..\\etc\\passwd')).toBeUndefined()
  })

  test('mount 外的绝对路径被拒绝', () => {
    expect(resolveArtifactInsideMount(MOUNT, 'D:\\other\\x.md')).toBeUndefined()
  })
})
