/** ask_user 工具 —— 需要澄清时用结构化问题暂停当前任务。 */

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AskUserQuestion } from '../../shared/types/permission.ts'

export interface AskUserHooks {
  requestAnswers: (
    questions: AskUserQuestion[],
    signal?: AbortSignal,
  ) => Promise<Array<{ questionId: string; value: string }>>
}

const optionSchema = Type.Object({
  label: Type.String({ description: '简短选项文字，推荐项在末尾加（推荐）' }),
  description: Type.String({ description: '一句话解释这个选项的影响' }),
})

const questionSchema = Type.Object({
  header: Type.String({ description: '12 个字以内的短标题' }),
  question: Type.String({ description: '要向用户确认的问题' }),
  options: Type.Array(optionSchema, {
    minItems: 2,
    maxItems: 3,
    description: '2 到 3 个互斥选项；界面另带自由输入',
  }),
})

export function buildAskUserTool(hooks: AskUserHooks): AgentTool {
  return {
    name: 'ask_user',
    label: '询问用户',
    description:
      '缺少会显著影响方案或结果的信息时，使用这个工具向用户提出 1 到 3 个结构化问题。' +
      '工具会等待用户回答后继续任务；不要用普通文本假装等待回答。',
    parameters: Type.Object({
      questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }),
    }),
    execute: async (_id, params, signal) => {
      const { questions: rawQuestions } = params as {
        questions: Array<Omit<AskUserQuestion, 'id'>>
      }
      const questions = rawQuestions.map((question, index) => ({
        ...question,
        id: `q${index + 1}`,
      }))
      const answers = await hooks.requestAnswers(questions, signal)

      if (answers.length === 0) {
        return {
          content: [{ type: 'text', text: '用户中止了问答。请停止当前任务或基于已有信息说明限制。' }],
          details: { action: 'read' },
        }
      }

      const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.value]))
      const text = questions
        .map((question) => `${question.header}：${answerMap.get(question.id) ?? '未回答'}`)
        .join('\n')
      return { content: [{ type: 'text', text }], details: { action: 'read' } }
    },
  }
}
