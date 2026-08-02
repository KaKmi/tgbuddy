import { describe, expect, test } from 'bun:test'
import { buildMcpTool } from '../../../src/kernel/pi/pi-mcp-tool.ts'

describe('MCP 授权身份', () => {
  test('endpoint 或 schema 身份变化时不发送请求', async () => {
    let currentIdentity = 'server-1:schema-1:endpoint-a'
    let calls = 0
    const tool = buildMcpTool({
      toolId: 'calendar.create',
      method: 'create',
      label: 'create',
      description: '创建日程',
      expectedIdentity: currentIdentity,
      assertIdentity(expected) {
        if (expected !== currentIdentity) {
          const error = new Error('调用目标身份已变化')
          Object.assign(error, { code: 'resource_identity_changed' })
          throw error
        }
      },
      call: async () => {
        calls += 1
        return 'ok'
      },
    })

    currentIdentity = 'server-2:schema-1:endpoint-b'
    await expect(tool.execute('call-1', {}, undefined, () => {})).rejects.toMatchObject({
      code: 'resource_identity_changed',
    })
    expect(calls).toBe(0)
  })
})
