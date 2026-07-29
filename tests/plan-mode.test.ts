import { describe, expect, test } from 'bun:test'
import { buildPlanModeTools } from '../src/main/tools/plan-mode.ts'

describe('计划模式中断', () => {
  test('exit_plan_mode 把工具的 AbortSignal 传给审批等待', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const tools = buildPlanModeTools({
      getMode: () => 'plan',
      setMode: () => {},
      onModeChanged: () => {},
      requestApproval: (_plan, signal) => {
        receivedSignal = signal
        return new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => resolve({ approved: false, reason: '操作已中止' }),
            { once: true },
          )
        })
      },
    })
    const exitTool = tools.find((tool) => tool.name === 'exit_plan_mode')
    if (!exitTool) throw new Error('缺少 exit_plan_mode 工具')

    const execution = exitTool.execute('tool-1', { plan: '测试计划' }, controller.signal)
    expect(receivedSignal).toBe(controller.signal)

    controller.abort()
    const result = await execution
    const text = result.content.find((item) => item.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toContain('操作已中止')
  })
})
