import { describe, expect, test } from 'bun:test'
import { buildMcpTool } from '../../../src/kernel/pi/pi-mcp-tool.ts'

describe('MCP 工具（pi adapter）', () => {
  test('调用转发给服务并返回文本结果', async () => {
    const tool = buildMcpTool({
      toolId: 'pg.query',
      method: 'query',
      label: 'query',
      description: '查询只读库',
      expectedIdentity: 'identity-1',
      assertIdentity: () => {},
      call: async (args) => `rows:${String(args.sql ?? '')}`,
    })
    const result = await tool.execute(
      'call-1',
      { sql: 'select 1' },
      new AbortController().signal,
      () => {},
    )
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'rows:select 1' })
  })

  test('结构化错误抛到工具层（卡片显示失败态）', async () => {
    const tool = buildMcpTool({
      toolId: 'pg.exec',
      method: 'exec',
      label: 'exec',
      description: '执行写语句',
      expectedIdentity: 'identity-1',
      assertIdentity: () => {},
      call: async () => {
        throw new Error('服务端报错')
      },
    })
    await expect(
      tool.execute('call-2', {}, new AbortController().signal, () => {}),
    ).rejects.toThrow(/服务端报错/)
  })

  test('取消信号透传给服务调用', async () => {
    let receivedSignal: AbortSignal | undefined
    const tool = buildMcpTool({
      toolId: 'pg.query',
      method: 'query',
      label: 'query',
      description: '查询',
      expectedIdentity: 'identity-1',
      assertIdentity: () => {},
      call: async (_args, signal) => {
        receivedSignal = signal
        return 'ok'
      },
    })
    const controller = new AbortController()
    await tool.execute('call-3', {}, controller.signal, () => {})
    expect(receivedSignal).toBe(controller.signal)
  })
})
