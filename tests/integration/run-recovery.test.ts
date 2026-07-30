import { describe, expect, test } from 'bun:test'
import {
  createRunCoordinator,
  recoverInterruptedRuns,
  type AgentEngine,
  type AgentInvocation,
  type RunRecoveryHistory,
  type SessionRepository,
} from '../../src/runtime/index.ts'
import type {
  NoticeMessage,
  SessionMessage,
} from '../../src/shared/contracts/message.ts'
import type { SessionMeta } from '../../src/shared/contracts/session.ts'

class MemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<string, SessionMeta>()

  list(): SessionMeta[] {
    return [...this.#sessions.values()]
  }

  get(sessionId: string): SessionMeta | undefined {
    return this.#sessions.get(sessionId)
  }

  create(session: SessionMeta): SessionMeta {
    this.#sessions.set(session.id, session)
    return session
  }

  update(session: SessionMeta): SessionMeta {
    if (!this.#sessions.has(session.id)) {
      throw new Error(`Session 不存在：${session.id}`)
    }
    this.#sessions.set(session.id, session)
    return session
  }

  delete(sessionId: string): boolean {
    return this.#sessions.delete(sessionId)
  }
}

class MemoryRecoveryHistory implements RunRecoveryHistory {
  readonly messages = new Map<string, SessionMessage[]>()

  append(sessionId: string, message: NoticeMessage): Promise<void> {
    this.messages.set(sessionId, [
      ...(this.messages.get(sessionId) ?? []),
      message,
    ])
    return Promise.resolve()
  }
}

function invocation(sessionId: string): AgentInvocation {
  return {
    sessionId,
    text: '继续',
    cwd: 'C:\\fixture',
    channel: {
      id: 'test',
      name: 'Test',
      protocol: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      models: [{
        id: 'test-model',
        name: 'Test Model',
        contextWindow: 4096,
        maxTokens: 1024,
      }],
    },
    modelId: 'test-model',
    systemPrompt: '测试',
  }
}

describe('Run 崩溃恢复', () => {
  test('重建 Runtime 把 running 收口为 interrupted，保留历史且下一 Run 可启动', async () => {
    const repository = new MemorySessionRepository()
    repository.create({
      id: 'session-running',
      title: '未完成任务',
      status: 'running',
      statusDetail: '正在执行',
      lastActivity: '正在写文件…',
      createdAt: 10,
      updatedAt: 20,
    })
    repository.create({
      id: 'session-done',
      title: '已完成任务',
      status: 'done',
      createdAt: 11,
      updatedAt: 21,
    })

    const history = new MemoryRecoveryHistory()
    history.messages.set('session-running', [{
      kind: 'kernel',
      id: 'message-user',
      createdAt: 15,
      message: {
        role: 'user',
        content: '开始任务',
        timestamp: 15,
      },
    }])
    let sequence = 0

    const report = await recoverInterruptedRuns({
      sessions: repository,
      history,
      createId: () => `notice-${++sequence}`,
      now: () => 100,
    })

    expect(report.failures).toEqual([])
    expect(report.recovered.map((session) => session.id)).toEqual([
      'session-running',
    ])
    expect(repository.get('session-running')).toMatchObject({
      status: 'interrupted',
      statusDetail: '上次运行被意外中断',
      lastActivity: undefined,
    })
    expect(repository.get('session-done')?.status).toBe('done')
    expect(history.messages.get('session-running')?.map((message) => message.kind)).toEqual([
      'kernel',
      'notice',
    ])
    expect(history.messages.get('session-running')?.[1]).toMatchObject({
      kind: 'notice',
      notice: 'session_resumed',
      display: true,
    })

    const repeated = await recoverInterruptedRuns({
      sessions: repository,
      history,
      createId: () => `notice-${++sequence}`,
      now: () => 101,
    })
    expect(repeated.recovered).toEqual([])
    expect(history.messages.get('session-running')?.length).toBe(2)

    const engine: AgentEngine = {
      async *run() {
        yield { type: 'run_start' }
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 200,
      engine,
      createInvocation: (input) =>
        Promise.resolve(invocation(input.sessionId)),
      lifecycle: {
        async started(sessionId) {
          const current = repository.get(sessionId)
          if (!current) throw new Error('Session 不存在')
          return repository.update({
            ...current,
            status: 'running',
            statusDetail: undefined,
            updatedAt: 201,
          })
        },
        async settled({ sessionId, status, detail }) {
          const current = repository.get(sessionId)
          if (!current) throw new Error('Session 不存在')
          return repository.update({
            ...current,
            status,
            statusDetail: detail,
            updatedAt: 202,
          })
        },
      },
    })

    expect(coordinator.isRunning('session-running')).toBe(false)
    await coordinator.send(
      { sessionId: 'session-running', text: '继续' },
      () => undefined,
    )
    expect(coordinator.isRunning('session-running')).toBe(false)
    expect(repository.get('session-running')?.status).toBe('done')
    expect(history.messages.get('session-running')?.length).toBe(2)
    await coordinator.dispose()
  })
})
