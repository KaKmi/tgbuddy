import { describe, expect, test } from 'bun:test'
import {
  createBeforeToolCall,
  isControlTool,
  setMode,
} from '../src/main/permission-service.ts'

describe('计划模式控制工具', () => {
  test('计划切换、审批和用户问答不会被权限模式拦截', async () => {
    expect(isControlTool('enter_plan_mode')).toBe(true)
    expect(isControlTool('exit_plan_mode')).toBe(true)
    expect(isControlTool('ask_user')).toBe(true)
    expect(isControlTool('write')).toBe(false)

    setMode('session-1', 'plan')
    const beforeToolCall = createBeforeToolCall('session-1', () => {
      throw new Error('控制工具不应发起授权请求')
    })

    for (const name of ['enter_plan_mode', 'exit_plan_mode', 'ask_user']) {
      await expect(
        beforeToolCall({ toolCall: { id: `tool-${name}`, name }, args: {} }),
      ).resolves.toBeUndefined()
    }
  })
})
