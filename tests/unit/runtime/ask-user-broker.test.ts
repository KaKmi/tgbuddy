import { describe, expect, test } from 'bun:test'
import {
  createAskUserBroker,
  type AskUserBroker,
} from '../../../src/runtime/index.ts'
import type { AskUserRequest } from '../../../src/shared/contracts/permission.ts'

function harness(): {
  broker: AskUserBroker
  emitted: AskUserRequest[]
} {
  const emitted: AskUserRequest[] = []
  let sequence = 0
  const broker = createAskUserBroker({
    createId: () => `ask-${++sequence}`,
    emitRequest(request) {
      emitted.push(request)
    },
  })
  return { broker, emitted }
}

const QUESTIONS = [
  {
    id: 'q1',
    header: '目标',
    question: '这个任务要解决什么问题？',
    options: [
      { label: '修复', description: '修现有问题' },
      { label: '新建', description: '从零开始' },
    ],
  },
  {
    id: 'q2',
    header: '范围',
    question: '涉及哪些模块？',
    options: [
      { label: '后端', description: '服务端' },
      { label: '前端', description: '界面' },
    ],
  },
]

describe('AskUserBroker', () => {
  test('requestAnswers 登记并推送，pending 快照可恢复（重载）', async () => {
    const { broker, emitted } = harness()
    const result = broker.requestAnswers(
      { sessionId: 'session-1', questions: QUESTIONS },
      new AbortController().signal,
    )

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      requestId: 'ask-1',
      sessionId: 'session-1',
      questions: QUESTIONS,
    })
    expect(broker.pending()).toHaveLength(1)

    broker.respond({
      requestId: 'ask-1',
      answers: [
        { questionId: 'q1', value: '修复' },
        { questionId: 'q2', value: '后端' },
      ],
    })
    await expect(result).resolves.toEqual([
      { questionId: 'q1', value: '修复' },
      { questionId: 'q2', value: '后端' },
    ])
    expect(broker.pending()).toEqual([])
  })

  test('stop（AbortSignal）返回空答案，clearSession 只清理目标会话', async () => {
    const { broker } = harness()
    const controller = new AbortController()
    const aborted = broker.requestAnswers(
      { sessionId: 'session-1', questions: QUESTIONS },
      controller.signal,
    )
    controller.abort()
    await expect(aborted).resolves.toEqual([])

    const kept = broker.requestAnswers(
      { sessionId: 'session-2', questions: QUESTIONS },
      new AbortController().signal,
    )
    const discarded = broker.requestAnswers(
      { sessionId: 'session-3', questions: QUESTIONS },
      new AbortController().signal,
    )
    broker.clearSession('session-3')
    await expect(discarded).resolves.toEqual([])
    expect(broker.pending()).toHaveLength(1)
    expect(broker.pending()[0]?.sessionId).toBe('session-2')

    broker.respond({
      requestId: 'ask-2',
      answers: [{ questionId: 'q1', value: '后端' }],
    })
    await expect(kept).resolves.toEqual([{ questionId: 'q1', value: '后端' }])
    expect(broker.pending()).toEqual([])
  })

  test('过期/未知 requestId 的响应被忽略', async () => {
    const { broker } = harness()
    broker.requestAnswers(
      { sessionId: 'session-1', questions: QUESTIONS },
      new AbortController().signal,
    )

    expect(broker.respond({ requestId: 'missing', answers: [] })).toBe(false)
    expect(broker.respond({ requestId: 'ask-1', answers: [] })).toBe(true)
    expect(broker.respond({ requestId: 'ask-1', answers: [] })).toBe(false)
  })
})
