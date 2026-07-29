import { describe, expect, test } from 'bun:test'
import { allocateContextBreakdown, buildContextUsage } from '../src/kernel/context-usage.ts'
import { buildContextRows, formatTokens } from '../src/renderer/components/ContextUsagePanel.tsx'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Usage } from '@earendil-works/pi-ai'

const usage: Usage = {
  input: 6_000,
  output: 1_000,
  cacheRead: 2_000,
  cacheWrite: 0,
  totalTokens: 9_000,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 },
}

describe('上下文用量', () => {
  test('优先使用供应商总量并按模型窗口计算百分比', () => {
    const result = buildContextUsage({
      messages: [
        { role: 'user', content: [{ type: 'text', text: '测试消息' }], timestamp: 1 },
      ] satisfies AgentMessage[],
      systemPrompt: '系统提示词',
      tools: [{ name: 'read', description: '读取文件', parameters: { type: 'object' } }],
      contextWindow: 20_000,
      usage,
      now: 123,
    })

    expect(result.usedTokens).toBe(9_000)
    expect(result.percent).toBe(45)
    expect(result.outputTokens).toBe(1_000)
    expect(result.updatedAt).toBe(123)
    expect(Object.values(result.breakdown).reduce((sum, value) => sum + value, 0)).toBe(9_000)
  })

  test('分类估算超过供应商总量时会按比例收缩', () => {
    const breakdown = allocateContextBreakdown(100, 80, 120)

    expect(breakdown).toEqual({ systemPrompt: 40, tools: 60, messages: 0, skills: 0, mcp: 0 })
  })

  test('面板行和 token 缩写保持稳定', () => {
    const result = buildContextUsage({
      messages: [],
      systemPrompt: '',
      tools: [],
      contextWindow: 1_000_000,
      usage,
    })

    expect(buildContextRows(result).map((row) => row.label)).toEqual([
      '系统提示词',
      '工具及子智能体',
      '对话消息',
      '技能',
      '连接器及 MCP',
    ])
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(12_340)).toBe('12.3K')
    expect(formatTokens(1_000_000)).toBe('1.00M')
  })
})
