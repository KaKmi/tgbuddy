import { describe, expect, test } from 'bun:test'
import {
  isAskUserComplete,
  resolveAskUserAnswer,
} from '../src/renderer/components/ask-user-answer.ts'
import type { AskUserQuestion } from '../src/shared/types/permission.ts'

const questions: AskUserQuestion[] = [
  {
    id: 'q1',
    header: '目标',
    question: '这次修改的目标是什么？',
    options: [
      { label: '修复 bug', description: '修复现有问题' },
      { label: '加功能（推荐）', description: '新增能力' },
    ],
  },
  {
    id: 'q2',
    header: '范围',
    question: '影响范围？',
    options: [
      { label: '单文件', description: '只动一个文件' },
      { label: '多文件', description: '涉及多个文件' },
    ],
  },
]

describe('AskUserCard 回答判定', () => {
  test('选中选项后无需在「其他答案」输入框打字即可提交', () => {
    const answers = { q1: '修复 bug', q2: '单文件' }
    // 选中选项时组件会把 custom 对应项清成空串，必须视作「无自定义答案」
    const custom = { q1: '', q2: '' }

    expect(isAskUserComplete(questions, custom, answers)).toBe(true)
    expect(resolveAskUserAnswer('q1', custom, answers)).toBe('修复 bug')
  })

  test('自定义答案优先于已选选项', () => {
    const answers = { q1: '修复 bug' }
    const custom = { q1: '改成加功能' }

    expect(resolveAskUserAnswer('q1', custom, answers)).toBe('改成加功能')
  })

  test('任一问题未作答（既无选项也无自定义）时不允许提交', () => {
    const answers = { q1: '修复 bug' }
    const custom = { q1: '' }

    expect(isAskUserComplete(questions, custom, answers)).toBe(false)
  })
})
