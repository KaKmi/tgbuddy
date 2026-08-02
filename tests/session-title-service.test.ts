import { describe, expect, test } from 'bun:test'
import type { SessionMeta } from '../src/shared/contracts/session.ts'
import type { SessionRepository } from '../src/runtime/sessions/session-repository.ts'
import {
  createSessionTitleService,
  type TitleGenerator,
} from '../src/runtime/sessions/session-title-service.ts'

class FakeSessions implements SessionRepository {
  #session: SessionMeta

  constructor(session: SessionMeta) {
    this.#session = session
  }

  list(): SessionMeta[] { return [this.#session] }
  get(): SessionMeta { return this.#session }
  create(session: SessionMeta): SessionMeta { this.#session = session; return session }
  update(session: SessionMeta): SessionMeta { this.#session = session; return session }
  delete(): boolean { return false }
}

function initial(): SessionMeta {
  return {
    id: 'session-1',
    title: '新会话',
    titleSource: 'default',
    channelId: 'channel-1',
    modelId: 'model-1',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('Session 自动标题', () => {
  test('清洗引号与换行，并限制中文标题为 24 个字符', async () => {
    const sessions = new FakeSessions(initial())
    const generator: TitleGenerator = {
      generate: async () => '“这是一个非常非常非常非常非常非常非常长的\n会话标题”',
    }
    const service = createSessionTitleService({ sessions, generator, now: () => 2 })

    await service.request({ sessionId: 'session-1', userMessage: '原始消息' })

    expect(Array.from(sessions.get().title).length).toBeLessThanOrEqual(24)
    expect(sessions.get().title).not.toMatch(/[“”\n]/)
    expect(sessions.get().titleSource).toBe('generated')
  })

  test('同一 Session 只生成一次', async () => {
    const sessions = new FakeSessions(initial())
    let calls = 0
    const service = createSessionTitleService({
      sessions,
      generator: { generate: async () => { calls += 1; return '首个标题' } },
      now: () => 2,
    })

    await service.request({ sessionId: 'session-1', userMessage: '第一条' })
    await service.request({ sessionId: 'session-1', userMessage: '第二条' })

    expect(calls).toBe(1)
    expect(sessions.get().title).toBe('首个标题')
  })

  test('手动改名先到时，迟到生成结果不能覆盖 user 标题', async () => {
    const sessions = new FakeSessions(initial())
    let finish: ((title: string) => void) | undefined
    const service = createSessionTitleService({
      sessions,
      generator: {
        generate: () => new Promise((resolve) => { finish = resolve }),
      },
      now: () => 3,
    })

    const pending = service.request({ sessionId: 'session-1', userMessage: '第一条' })
    await Promise.resolve()
    sessions.update({ ...sessions.get(), title: '用户标题', titleSource: 'user', updatedAt: 2 })
    finish?.('模型标题')
    await pending

    expect(sessions.get().title).toBe('用户标题')
    expect(sessions.get().titleSource).toBe('user')
  })

  test('Provider 失败或超时使用首条文本安全截断', async () => {
    const failedSessions = new FakeSessions(initial())
    const failed = createSessionTitleService({
      sessions: failedSessions,
      generator: { generate: async () => { throw new Error('离线') } },
      now: () => 2,
    })
    const longAscii = 'a'.repeat(100)
    await failed.request({ sessionId: 'session-1', userMessage: longAscii })
    expect(failedSessions.get().title).toHaveLength(60)

    const timeoutSessions = new FakeSessions(initial())
    const timeout = createSessionTitleService({
      sessions: timeoutSessions,
      generator: { generate: () => new Promise(() => {}) },
      now: () => 2,
      timeoutMs: 5,
    })
    await timeout.request({ sessionId: 'session-1', userMessage: '超时回退标题' })
    expect(timeoutSessions.get().title).toBe('超时回退标题')
  })
})
