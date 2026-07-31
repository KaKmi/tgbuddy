import { describe, expect, test } from 'bun:test'
import { createSessionCommands } from '../../../src/runtime/sessions/session-commands.ts'
import type { SessionRepository } from '../../../src/runtime/sessions/session-repository.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'

class MemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionMeta>()
  deleteError: Error | undefined

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
    if (this.deleteError) throw this.deleteError
    return this.sessions.delete(sessionId)
  }
}

describe('SessionCommands', () => {
  test('创建、重启可见、更新和删除组合 catalog 与消息后端', async () => {
    const repository = new MemorySessionRepository()
    const calls: string[] = []
    const history = {
      async create(sessionId: string, cwd: string) {
        calls.push(`create:${sessionId}:${cwd}`)
      },
      async messages(sessionId: string) {
        calls.push(`messages:${sessionId}`)
        return []
      },
      async compactedMessages(sessionId: string, compactionId: string) {
        calls.push(`compacted:${sessionId}:${compactionId}`)
        return []
      },
      async truncate(sessionId: string, fromMessageId: string) {
        calls.push(`truncate:${sessionId}:${fromMessageId}`)
        return []
      },
      async clonePrefix() {
        return []
      },
      async delete(sessionId: string) {
        calls.push(`delete:${sessionId}`)
      },
    }
    const first = createSessionCommands({
      repository,
      history,
      createId: () => 'session-1',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
    })

    expect(await first.create({
      title: '第一条',
      channelId: 'channel-1',
      modelId: 'model-1',
    })).toEqual({
      id: 'session-1',
      title: '第一条',
      channelId: 'channel-1',
      modelId: 'model-1',
      createdAt: 100,
      updatedAt: 100,
    })
    expect(await first.messages('session-1')).toEqual([])
    expect(await first.compactedMessages('session-1', 'compaction-1')).toEqual([])
    expect(await first.truncate('session-1', 'message-1')).toEqual([])

    const reopened = createSessionCommands({
      repository,
      history,
      createId: () => 'unused',
      now: () => 200,
      resolveCwd: () => 'C:\\workspace',
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

    await reopened.delete('session-1')
    expect(reopened.list()).toEqual([])
    expect(calls).toEqual([
      'create:session-1:C:\\workspace',
      'messages:session-1',
      'compacted:session-1:compaction-1',
      'truncate:session-1:message-1',
      'delete:session-1',
    ])
  })

  test('更新不存在的 Session 保持旧契约的 no-op 语义', () => {
    const repository = new MemorySessionRepository()
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => undefined,
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async () => [],
        delete: async () => undefined,
      },
      createId: () => 'unused',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
    })

    expect(() => commands.updateMeta('missing', { title: '忽略' })).not.toThrow()
    expect(repository.list()).toEqual([])
  })

  test('从历史点新建扁平 Session，继承运行配置并记录 originRef', async () => {
    const repository = new MemorySessionRepository()
    const cloneCalls: string[] = []
    const ids = ['session-source', 'session-clone']
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => undefined,
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async (sourceId, targetId, messageId, cwd) => {
          cloneCalls.push(`${sourceId}:${targetId}:${messageId}:${cwd}`)
          return []
        },
        delete: async () => undefined,
      },
      createId: () => ids.shift() ?? 'unused',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
    })
    await commands.create({
      title: '原会话',
      channelId: 'channel-1',
      modelId: 'model-1',
    })
    commands.updateMeta('session-source', {
      workspaceId: 'workspace-1',
      expertId: 'expert-1',
      permissionMode: 'plan',
    })

    const cloned = await commands.clonePrefix({
      sourceSessionId: 'session-source',
      throughMessageId: 'message-2',
    })

    expect(cloned).toMatchObject({
      id: 'session-clone',
      title: '原会话',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      modelId: 'model-1',
      expertId: 'expert-1',
      permissionMode: 'plan',
      originRef: {
        sessionId: 'session-source',
        messageId: 'message-2',
      },
    })
    expect(cloneCalls).toEqual([
      'session-source:session-clone:message-2:C:\\workspace',
    ])
    expect(repository.get('session-source')).toBeDefined()
    expect(repository.get('session-clone')).toEqual(cloned)
  })

  test('消息后端创建失败时回滚 catalog，避免半会话', async () => {
    const repository = new MemorySessionRepository()
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => {
          throw new Error('消息后端不可用')
        },
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async () => [],
        delete: async () => undefined,
      },
      createId: () => 'session-failed',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
    })

    await expect(commands.create({})).rejects.toThrow('消息后端不可用')
    expect(repository.list()).toEqual([])
  })

  test('catalog 删除失败时保留消息历史，不产生可见空会话', async () => {
    const repository = new MemorySessionRepository()
    const calls: string[] = []
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => undefined,
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async () => [],
        delete: async (sessionId) => {
          calls.push(`history.delete:${sessionId}`)
        },
      },
      createId: () => 'session-1',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
    })
    await commands.create({})
    repository.deleteError = new Error('catalog busy')

    await expect(commands.delete('session-1')).rejects.toThrow('catalog busy')
    expect(repository.get('session-1')).toBeDefined()
    expect(calls).toEqual([])
  })

  test('history 清理失败时保持 catalog 已删除并上报孤儿清理错误', async () => {
    const repository = new MemorySessionRepository()
    const cleanupErrors: Array<{ sessionId: string; error: unknown }> = []
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => undefined,
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async () => [],
        delete: async () => {
          throw new Error('history busy')
        },
      },
      createId: () => 'session-1',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
      onHistoryDeleteError(sessionId, error) {
        cleanupErrors.push({ sessionId, error })
      },
    })
    await commands.create({})

    await commands.delete('session-1')
    expect(repository.get('session-1')).toBeUndefined()
    expect(cleanupErrors).toHaveLength(1)
    expect(cleanupErrors[0]?.sessionId).toBe('session-1')
    expect(cleanupErrors[0]?.error).toBeInstanceOf(Error)
  })

  test('提供 workspaceId 后 list 只返回当前工作区 Session，create 绑定当前工作区', async () => {
    const repository = new MemorySessionRepository()
    repository.create({
      id: 'other-ws',
      title: '其它工作区',
      workspaceId: 'ws-2',
      createdAt: 1,
      updatedAt: 2,
    })
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => undefined,
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async () => [],
        delete: async () => undefined,
      },
      createId: () => 'session-1',
      now: () => 100,
      resolveCwd: () => 'C:\\workspace',
      workspaceId: () => 'ws-1',
    })

    const created = await commands.create({ title: '当前工作区' })

    expect(created.workspaceId).toBe('ws-1')
    expect(commands.list().map((session) => session.id)).toEqual(['session-1'])
  })

  test('clonePrefix 保留源 Session 的 workspaceId', async () => {
    const repository = new MemorySessionRepository()
    repository.create({
      id: 'session-source',
      title: '源会话',
      workspaceId: 'ws-1',
      createdAt: 1,
      updatedAt: 2,
    })
    const commands = createSessionCommands({
      repository,
      history: {
        create: async () => undefined,
        messages: async () => [],
        compactedMessages: async () => [],
        truncate: async () => [],
        clonePrefix: async () => [],
        delete: async () => undefined,
      },
      createId: () => 'session-clone',
      now: () => 200,
      resolveCwd: () => 'C:\\workspace',
    })

    const clone = await commands.clonePrefix({
      sourceSessionId: 'session-source',
      throughMessageId: 'message-1',
    })

    expect(clone.workspaceId).toBe('ws-1')
  })
})
