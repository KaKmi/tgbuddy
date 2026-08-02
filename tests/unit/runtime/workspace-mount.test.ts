import { describe, expect, test } from 'bun:test'
import { mountFailureMessage } from '../../../src/runtime/workspaces/workspace-mount-resolver.ts'

describe('mountFailureMessage', () => {
  test('缺失目录给出恢复动作而不是默默回退', () => {
    const message = mountFailureMessage({
      ok: false,
      code: 'missing',
      path: 'C:\\gone',
    })
    expect(message).toContain('C:\\gone')
    expect(message).toContain('重新选择')
  })

  test('文件冒充目录明确提示不是文件夹', () => {
    const message = mountFailureMessage({
      ok: false,
      code: 'not-directory',
      path: 'C:\\file.txt',
    })
    expect(message).toContain('不是文件夹')
  })

  test('不可访问目录提示检查权限', () => {
    const message = mountFailureMessage({
      ok: false,
      code: 'unreadable',
      path: 'C:\\locked',
    })
    expect(message).toContain('不可访问')
  })
})
