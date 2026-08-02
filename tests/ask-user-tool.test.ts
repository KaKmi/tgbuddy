import { describe, expect, test } from 'bun:test'
import { buildAskUserTool } from '../src/kernel/pi/pi-ask-user.ts'
import type { AskUserQuestion } from '../src/shared/contracts/permission.ts'

describe('ask_user 工具', () => {
  test('1–3 个结构化问题带 id 提交，回答后格式化为结果', async () => {
    let received: AskUserQuestion[] | undefined
    const tool = buildAskUserTool({
      requestAnswers: async (questions) => {
        received = questions
        return [
          { questionId: 'q1', value: '修复' },
          { questionId: 'q2', value: '后端' },
        ]
      },
    })

    const result = await tool.execute(
      'tool-1',
      {
        questions: [
          {
            header: '目标',
            question: '要解决什么问题？',
            options: [
              { label: '修复', description: '修现有问题' },
              { label: '新建', description: '从零开始' },
            ],
          },
          {
            header: '范围',
            question: '涉及哪些模块？',
            options: [
              { label: '后端', description: '服务端' },
              { label: '前端', description: '界面' },
            ],
          },
        ],
      },
      new AbortController().signal,
    )
    const text = result.content.find((item) => item.type === 'text')

    expect(received?.map((question) => question.id)).toEqual(['q1', 'q2'])
    expect(text?.type === 'text' ? text.text : '').toContain('目标：修复')
    expect(text?.type === 'text' ? text.text : '').toContain('范围：后端')
  })

  test('中止（空答案）提示模型停止或基于已有信息说明', async () => {
    const controller = new AbortController()
    const tool = buildAskUserTool({
      requestAnswers: async (_questions, signal) => {
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return []
      },
    })
    const execution = tool.execute(
      'tool-1',
      {
        questions: [
          {
            header: '目标',
            question: '要解决什么问题？',
            options: [
              { label: '修复', description: '修现有问题' },
              { label: '新建', description: '从零开始' },
            ],
          },
        ],
      },
      controller.signal,
    )
    controller.abort()
    const result = await execution
    const text = result.content.find((item) => item.type === 'text')

    expect(text?.type === 'text' ? text.text : '').toContain('用户中止了问答')
  })
})
