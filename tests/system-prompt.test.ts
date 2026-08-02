import { describe, expect, test } from 'bun:test'
import { buildSystemPrompt } from '../src/main/bootstrap/create-legacy-runtime.ts'

describe('专家系统提示词组合', () => {
  test('专家指令不会覆盖工作区、计划模式与技能摘要', () => {
    const prompt = buildSystemPrompt(
      'C:\\workspace',
      'plan',
      [{
        id: 'builtin:reg-check',
        name: 'reg-check',
        title: '监管口径核对',
        description: '核对监管口径',
        version: '1.0.0',
        source: 'builtin',
        root: 'C:\\skills\\reg-check',
        enabled: true,
      }],
      '你是风险分析专家。',
    )

    expect(prompt).toContain('当前工作目录：C:\\workspace')
    expect(prompt).toContain('## 专家指令\n你是风险分析专家。')
    expect(prompt).toContain('## 计划模式')
    expect(prompt).toContain('直接调用 exit_plan_mode')
    expect(prompt).toContain('批准前不得尝试执行副作用')
    expect(prompt).toContain('工具返回失败时，不得声称已经完成')
    expect(prompt).toContain('reg-check')
  })
})
