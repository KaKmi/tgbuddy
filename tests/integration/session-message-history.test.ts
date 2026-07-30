import { describe, expect, test } from 'bun:test'
import type {
  CreateMessageSessionInput,
  MessageSession,
  MessageStore,
} from '../../src/runtime/sessions/message-store.ts'
import { createSessionMessageHistory } from '../../src/runtime/sessions/session-message-history.ts'
import { createSessionCommands } from '../../src/runtime/sessions/session-commands.ts'
import type { SessionRepository } from '../../src/runtime/sessions/session-repository.ts'
import type {
  PersistedSessionEntry,
  SessionMessage,
} from '../../src/shared/contracts/message.ts'
import { KERNEL_ID } from '../../src/shared/contracts/message.ts'
import type { SessionMeta } from '../../src/shared/contracts/session.ts'

class MemoryMessageSession implements MessageSession {
  readonly sessionId: string
  readonly persisted: PersistedSessionEntry[]

  constructor(sessionId: string, persisted: PersistedSessionEntry[]) {
    this.sessionId = sessionId
    this.persisted = persisted
  }

  async entries(): Promise<PersistedSessionEntry[]> {
    return [...this.persisted]
  }

  async append(entry: PersistedSessionEntry): Promise<void> {
    this.persisted.push(entry)
  }

  async close(): Promise<void> {}
}

class MemoryMessageStore implements MessageStore {
  readonly entriesBySession = new Map<string, PersistedSessionEntry[]>()
  readonly kernels = new Map<string, string>()

  async create(input: CreateMessageSessionInput): Promise<MessageSession> {
    const entries: PersistedSessionEntry[] = []
    this.entriesBySession.set(input.sessionId, entries)
    this.kernels.set(input.sessionId, input.kernel)
    return new MemoryMessageSession(input.sessionId, entries)
  }

  async open(sessionId: string, kernel: string): Promise<MessageSession | undefined> {
    const entries = this.entriesBySession.get(sessionId)
    if (!entries) return undefined
    if (this.kernels.get(sessionId) !== kernel) throw new Error('kernel 不兼容')
    return new MemoryMessageSession(sessionId, entries)
  }

  async delete(sessionId: string): Promise<void> {
    this.entriesBySession.delete(sessionId)
    this.kernels.delete(sessionId)
  }

  async dispose(): Promise<void> {}
}

class MemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionMeta>()

  list(): SessionMeta[] {
    return [...this.sessions.values()]
  }

  get(sessionId: string): SessionMeta | undefined {
    return this.sessions.get(sessionId)
  }

  create(session: SessionMeta): SessionMeta {
    this.sessions.set(session.id, session)
    return session
  }

  update(session: SessionMeta): SessionMeta {
    this.sessions.set(session.id, session)
    return session
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }
}

function userMessage(
  id: string,
  createdAt: number,
): Extract<SessionMessage, { kind: 'kernel' }> {
  return {
    kind: 'kernel',
    id,
    createdAt,
    message: {
      role: 'user',
      content: [{ type: 'text', text: id }],
      timestamp: createdAt,
    },
  }
}

function successfulWriteMessages(createdAt: number): SessionMessage[] {
  return [
    {
      kind: 'kernel',
      id: 'write-call-message',
      createdAt,
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'write-call',
          name: 'write',
          arguments: { path: 'reports/result.md', content: '结果' },
        }],
        api: 'openai-responses',
        provider: 'test',
        model: 'test-model',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: createdAt,
      },
    },
    {
      kind: 'kernel',
      id: 'write-result-message',
      createdAt: createdAt + 1,
      message: {
        role: 'toolResult',
        toolCallId: 'write-call',
        toolName: 'write',
        content: [{ type: 'text', text: '写入成功' }],
        isError: false,
        timestamp: createdAt + 1,
      },
    },
  ]
}

describe('SessionMessageHistory', () => {
  test('模拟消息写入后重建 Runtime，信封、角色、顺序和 kernel 护栏保持一致', async () => {
    const store = new MemoryMessageStore()
    const repository = new MemorySessionRepository()
    const firstHistory = createSessionMessageHistory({
      store,
      createId: (() => {
        let value = 0
        return () => `generated-${++value}`
      })(),
      now: () => 1_700_000_000_000,
    })
    const first = createSessionCommands({
      repository,
      history: firstHistory,
      createId: () => 'session-1',
      now: () => 1_700_000_000_000,
      resolveCwd: () => 'C:\\workspace',
    })
    await first.create({ title: '集成测试' })
    await firstHistory.append('session-1', {
      kind: 'kernel',
      id: 'message-user',
      createdAt: 1_700_000_000_001,
      message: {
        role: 'user',
        content: [{ type: 'text', text: '请读取文件' }],
        timestamp: 1_700_000_000_001,
      },
    })
    await firstHistory.append('session-1', {
      kind: 'kernel',
      id: 'message-assistant',
      createdAt: 1_700_000_000_002,
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-1',
          name: 'read',
          arguments: { path: 'README.md' },
        }],
        api: 'openai-responses',
        provider: 'test',
        model: 'test-model',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 1_700_000_000_002,
      },
    })
    await firstHistory.append('session-1', {
      kind: 'kernel',
      id: 'message-tool',
      createdAt: 1_700_000_000_003,
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read',
        content: [{ type: 'text', text: '内容' }],
        isError: false,
        timestamp: 1_700_000_000_003,
      },
    })

    const reopenedHistory = createSessionMessageHistory({
      store,
      createId: () => 'unused',
      now: () => 1_700_000_000_100,
    })
    const reopened = createSessionCommands({
      repository,
      history: reopenedHistory,
      createId: () => 'unused',
      now: () => 1_700_000_000_100,
      resolveCwd: () => 'C:\\workspace',
    })
    const messages = await reopened.messages('session-1')

    expect(store.kernels.get('session-1')).toBe(KERNEL_ID)
    expect(messages.map((message) => message.id)).toEqual([
      'message-user',
      'message-assistant',
      'message-tool',
    ])
    expect(messages.map((message) =>
      message.kind === 'kernel' ? message.message.role : message.kind,
    )).toEqual(['user', 'assistant', 'toolResult'])
    expect(messages.map((message) => message.createdAt)).toEqual([
      1_700_000_000_001,
      1_700_000_000_002,
      1_700_000_000_003,
    ])
    expect(store.entriesBySession.get('session-1')?.map((entry) => entry.parentId)).toEqual([
      null,
      'message-user',
      'message-assistant',
    ])
  })

  test('压缩后只重放摘要、保留尾部和新消息，并可展开被压缩原文', async () => {
    const store = new MemoryMessageStore()
    const history = createSessionMessageHistory({
      store,
      createId: () => 'compaction-1',
      now: () => 1_700_000_000_010,
    })
    await history.create('session-1', 'C:\\workspace')
    await history.append('session-1', userMessage('message-1', 1_700_000_000_001))
    await history.append('session-1', userMessage('message-2', 1_700_000_000_002))
    await history.append('session-1', userMessage('message-3', 1_700_000_000_003))
    const marker = await history.appendCompaction('session-1', {
      summary: '前两条摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 100,
    })
    await history.append('session-1', userMessage('message-4', 1_700_000_000_004))

    expect(marker.compactedCount).toBe(2)
    expect((await history.messages('session-1')).map((message) => message.id)).toEqual([
      'compaction-1',
      'message-3',
      'message-4',
    ])
    expect(
      (await history.compactedMessages('session-1', 'compaction-1'))
        .map((message) => message.id),
    ).toEqual(['message-1', 'message-2'])
  })

  test('读取时拒绝不兼容的 kernel 元数据', async () => {
    const store = new MemoryMessageStore()
    const history = createSessionMessageHistory({
      store,
      createId: () => 'unused',
      now: Date.now,
    })
    await history.create('session-1', 'C:\\workspace')
    store.kernels.set('session-1', 'pi@0.81')

    await expect(history.messages('session-1')).rejects.toThrow('kernel 不兼容')
  })

  test('压缩不会让边界前已经成功生成的产物从计数中消失', async () => {
    const store = new MemoryMessageStore()
    const history = createSessionMessageHistory({
      store,
      createId: () => 'compaction-1',
      now: () => 1_700_000_000_010,
    })
    await history.create('session-1', 'C:\\workspace')
    for (const message of successfulWriteMessages(1_700_000_000_001)) {
      await history.append('session-1', message)
    }
    await history.append('session-1', userMessage('kept-message', 1_700_000_000_003))
    await history.appendCompaction('session-1', {
      summary: '写文件摘要',
      firstKeptEntryId: 'kept-message',
      tokensBefore: 100,
    })

    expect((await history.messages('session-1')).map((message) => message.id)).toEqual([
      'compaction-1',
      'kept-message',
    ])
    expect(await history.countArtifacts('session-1')).toBe(1)
  })

  test('legacy truncate 移除压缩边界后只回放摘要和迁移后的新消息', async () => {
    const store = new MemoryMessageStore()
    store.kernels.set('session-1', KERNEL_ID)
    store.entriesBySession.set('session-1', [
      {
        type: 'message',
        id: 'message-1',
        parentId: null,
        timestamp: new Date(1_700_000_000_001).toISOString(),
        message: userMessage('message-1', 1_700_000_000_001).message,
      },
      {
        type: 'message',
        id: 'message-2',
        parentId: 'message-1',
        timestamp: new Date(1_700_000_000_002).toISOString(),
        message: userMessage('message-2', 1_700_000_000_002).message,
      },
      {
        type: 'custom',
        id: 'synthetic-boundary',
        parentId: null,
        timestamp: new Date(1_700_000_000_003).toISOString(),
        customType: 'legacy.truncated_compaction_boundary',
        data: { legacyFirstKeptEntryId: 'message-2' },
      },
      {
        type: 'compaction',
        id: 'compaction-1',
        parentId: 'synthetic-boundary',
        timestamp: new Date(1_700_000_000_003).toISOString(),
        summary: '旧历史摘要',
        firstKeptEntryId: 'synthetic-boundary',
        tokensBefore: 100,
        details: {
          compactedCount: 1,
          legacyFirstKeptEntryId: 'message-2',
          legacyTruncated: true,
        },
      },
      {
        type: 'custom',
        id: 'truncate-1',
        parentId: 'compaction-1',
        timestamp: new Date(1_700_000_000_004).toISOString(),
        customType: 'legacy.truncate',
        data: { fromId: 'message-2' },
      },
      {
        type: 'leaf',
        id: 'legacy-leaf',
        parentId: 'truncate-1',
        timestamp: new Date(1_700_000_000_005).toISOString(),
        targetId: 'compaction-1',
      },
      {
        type: 'message',
        id: 'new-message',
        parentId: 'legacy-leaf',
        timestamp: new Date(1_700_000_000_006).toISOString(),
        message: userMessage('new-message', 1_700_000_000_006).message,
      },
    ])
    const history = createSessionMessageHistory({
      store,
      createId: () => 'unused',
      now: Date.now,
    })

    expect((await history.messages('session-1')).map((message) => message.id)).toEqual([
      'compaction-1',
      'new-message',
    ])
    expect(
      (await history.compactedMessages('session-1', 'compaction-1'))
        .map((message) => message.id),
    ).toEqual(['message-1'])
  })
})
