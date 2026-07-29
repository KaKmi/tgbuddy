import { describe, expect, test } from 'bun:test'
import { buildAskUserTool } from '../src/main/tools/ask-user.ts'

const QUESTIONS = [
  {
    header: '文章定位',
    question: '你希望文章面向谁？',
    options: [
      { label: '技术开发者（推荐）', description: '包含实现细节' },
      { label: '普通读者', description: '侧重概念和案例' },
    ],
  },
]

describe('ask_user 工具', () => {
  test('把结构化回答返回给模型', async () => {
    const tool = buildAskUserTool({
      requestAnswers: async (questions) => [
        { questionId: questions[0]!.id, value: '技术开发者（推荐）' },
      ],
    })

    const result = await tool.execute('tool-1', { questions: QUESTIONS })
    const text = result.content.find((item) => item.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toBe('文章定位：技术开发者（推荐）')
  })

  test('中断时返回明确提示', async () => {
    const tool = buildAskUserTool({ requestAnswers: async () => [] })

    const result = await tool.execute('tool-2', { questions: QUESTIONS })
    const text = result.content.find((item) => item.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toContain('用户中止了问答')
  })
})
