import { describe, expect, test } from 'bun:test'
import { buildPlanModeTools } from '../src/kernel/pi/pi-plan-mode.ts'

describe('计划模式中断', () => {
  function harness() {
    let mode: 'plan' | 'auto' | 'bypass' = 'plan'
    const changes: Array<{ mode: 'plan' | 'auto' | 'bypass'; source: 'user' | 'tool' }> = []
    const tools = buildPlanModeTools({
      getMode: () => mode,
      setMode: (next) => {
        mode = next
      },
      onModeChanged: (next, source) => changes.push({ mode: next, source }),
      requestApproval: async () => ({ approved: false, reason: '未触发' }),
    })
    return {
      tools,
      setMode: (next: 'plan' | 'auto' | 'bypass') => {
        mode = next
      },
      get changes() {
        return changes
      },
    }
  }

  test('exit_plan_mode 把工具的 AbortSignal 传给审批等待', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const state = harness()
    const tools = buildPlanModeTools({
      getMode: () => 'plan',
      setMode: () => {},
      onModeChanged: () => {},
      requestApproval: (_plan, _effects, signal) => {
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

  test('批准后保持计划模式，只允许批准效果', async () => {
    let receivedEffects: unknown
    const state = harness()
    const tools = buildPlanModeTools({
      getMode: () => 'plan',
      setMode: (next) => state.setMode(next),
      onModeChanged: (next, source) => {
        state.changes.push({ mode: next, source })
      },
      requestApproval: async (_plan, effects) => {
        receivedEffects = effects
        return { approved: true }
      },
    })
    const exitTool = tools.find((tool) => tool.name === 'exit_plan_mode')
    if (!exitTool) throw new Error('缺少 exit_plan_mode 工具')

    const result = await exitTool.execute('tool-1', {
      plan: '测试计划',
      effects: [{ tool: 'write', match: 'path', pattern: 'src/a.ts', maxRisk: 'R3' }],
    })
    const text = result.content.find((item) => item.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toContain('计划已批准')
    expect(state.changes).toEqual([])
    expect(receivedEffects).toEqual([
      { tool: 'write', match: 'path', pattern: 'src/a.ts', maxRisk: 'R3' },
    ])
  })

  test('拒绝后留在计划模式，把意见回给模型', async () => {
    const state = harness()
    const tools = buildPlanModeTools({
      getMode: () => 'plan',
      setMode: (next) => state.setMode(next),
      onModeChanged: (next, source) => {
        state.changes.push({ mode: next, source })
      },
      requestApproval: async () => ({ approved: false, reason: '先补数据库迁移' }),
    })
    const exitTool = tools.find((tool) => tool.name === 'exit_plan_mode')
    if (!exitTool) throw new Error('缺少 exit_plan_mode 工具')

    const result = await exitTool.execute('tool-1', { plan: '测试计划' })
    const text = result.content.find((item) => item.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toContain('先补数据库迁移')
    expect(text?.type === 'text' ? text.text : '').toContain('修改后重新提交')
    expect(state.changes).toEqual([])
  })
})
