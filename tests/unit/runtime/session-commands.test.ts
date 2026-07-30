import { describe, expect, test } from 'bun:test'
import { createSessionCommands } from '../../../src/runtime/sessions/session-commands.ts'
import type { SessionRepository } from '../../../src/runtime/sessions/session-repository.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'

class MemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionMeta>()

  list(workspaceId?: string): SessionMeta[] {
    return [...this.sessions.values()]
      .filter((session) => workspaceId === undefined || session.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  get(sessionId: string): SessionMeta | undefined {
    return this.sessions.get(sessionId)
  }

  create(session: SessionMeta): SessionMeta {
    this.sessions.set(session.id, session)
    return session
  }

  update(session: SessionMeta): SessionMeta {
    if (!this.sessions.has(session.id)) throw new Error(`Session 不存在: ${session.id}`)
    this.sessions.set(session.id, session)
    return session
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }
}

describe('SessionCommands', () => {
  test('创建、重启可见、更新和删除只替换 catalog，消息仍走注入后端', () => {
    const repository = new MemorySessionRepository()
    const calls: string[] = []
    const history = {
      messages(sessionId: string) {
        calls.push(`messages:${sessionId}`)
        return []
      },
      compactedMessages(sessionId: string, compactionId: string) {
        calls.push(`compacted:${sessionId}:${compactionId}`)
        return []
      },
      delete(sessionId: string) {
        calls.push(`delete:${sessionId}`)
      },
    }
    const first = createSessionCommands({
      repository,
      history,
      createId: () => 'session-1',
      now: () => 100,
    })

    expect(first.create({ title: '第一条', channelId: 'channel-1', modelId: 'model-1' })).toEqual({
      id: 'session-1',
      title: '第一条',
      channelId: 'channel-1',
      modelId: 'model-1',
      createdAt: 100,
      updatedAt: 100,
    })
    expect(first.messages('session-1')).toEqual([])
    expect(first.compactedMessages('session-1', 'compaction-1')).toEqual([])

    const reopened = createSessionCommands({
      repository,
      history,
      createId: () => 'unused',
      now: () => 200,
    })
    expect(reopened.list().map((session) => session.id)).toEqual(['session-1'])

    reopened.updateMeta('session-1', {
      title: '已更新',
      id: '不得覆盖',
      createdAt: 999,
    })
    expect(repository.get('session-1')).toEqual({
      id: 'session-1',
      title: '已更新',
      channelId: 'channel-1',
      modelId: 'model-1',
      createdAt: 999,
      updatedAt: 200,
    })

    reopened.delete('session-1')
    expect(reopened.list()).toEqual([])
    expect(calls).toEqual([
      'messages:session-1',
      'compacted:session-1:compaction-1',
      'delete:session-1',
    ])
  })

  test('更新不存在的 Session 保持旧契约的 no-op 语义', () => {
    const repository = new MemorySessionRepository()
    const commands = createSessionCommands({
      repository,
      history: {
        messages: () => [],
        compactedMessages: () => [],
        delete: () => undefined,
      },
      createId: () => 'unused',
      now: () => 100,
    })

    expect(() => commands.updateMeta('missing', { title: '忽略' })).not.toThrow()
    expect(repository.list()).toEqual([])
  })
})
