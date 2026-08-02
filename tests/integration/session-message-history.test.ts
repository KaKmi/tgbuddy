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
  readonly leaves: Map<string, string | null>

  constructor(
    sessionId: string,
    persisted: PersistedSessionEntry[],
    leaves: Map<string, string | null>,
  ) {
    this.sessionId = sessionId
    this.persisted = persisted
    this.leaves = leaves
  }

  async entries(): Promise<PersistedSessionEntry[]> {
    return [...this.persisted]
  }

  async activeEntries(): Promise<PersistedSessionEntry[]> {
    const byId = new Map(this.persisted.map((entry) => [entry.id, entry]))
    let entryId = this.leaves.has(this.sessionId)
      ? this.leaves.get(this.sessionId)
      : this.persisted.at(-1)?.id
    const branch: PersistedSessionEntry[] = []
    while (entryId) {
      const entry = byId.get(entryId)
      if (!entry) break
      branch.unshift(entry)
      entryId = entry.parentId ?? undefined
    }
    return branch
  }

  async append(entry: PersistedSessionEntry): Promise<void> {
    this.persisted.push(entry)
    this.leaves.set(this.sessionId, entry.id)
  }

  async moveTo(entryId: string | null): Promise<void> {
    if (entryId && !this.persisted.some((entry) => entry.id === entryId)) {
      throw new Error(`entry 不存在：${entryId}`)
    }
    this.leaves.set(this.sessionId, entryId)
  }

  async close(): Promise<void> {}
}

class MemoryMessageStore implements MessageStore {
  readonly entriesBySession = new Map<string, PersistedSessionEntry[]>()
  readonly kernels = new Map<string, string>()
  readonly leaves = new Map<string, string | null>()

  async create(input: CreateMessageSessionInput): Promise<MessageSession> {
    const entries: PersistedSessionEntry[] = []
    this.entriesBySession.set(input.sessionId, entries)
    this.kernels.set(input.sessionId, input.kernel)
    this.leaves.set(input.sessionId, null)
    return new MemoryMessageSession(input.sessionId, entries, this.leaves)
  }

  async open(sessionId: string, kernel: string): Promise<MessageSession | undefined> {
    const entries = this.entriesBySession.get(sessionId)
    if (!entries) return undefined
    if (this.kernels.get(sessionId) !== kernel) throw new Error('kernel 不兼容')
    return new MemoryMessageSession(sessionId, entries, this.leaves)
  }

  async delete(sessionId: string): Promise<void> {
    this.entriesBySession.delete(sessionId)
    this.kernels.delete(sessionId)
    this.leaves.delete(sessionId)
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
    const generatedIds = ['compaction-1', 'truncate-1', 'compaction-2']
    const history = createSessionMessageHistory({
      store,
      createId: () => generatedIds.shift() ?? 'unused',
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
    await history.truncate('session-1', 'kept-message')
    expect((await history.messages('session-1')).map((message) => message.id))
      .toEqual(['compaction-2'])
  })

  test('编辑并重发追加审计截断，重启后只恢复前缀与新消息', async () => {
    const store = new MemoryMessageStore()
    const generatedIds = ['truncate-1']
    const history = createSessionMessageHistory({
      store,
      createId: () => generatedIds.shift() ?? 'unused',
      now: () => 1_700_000_000_010,
    })
    await history.create('session-1', 'C:\\workspace')
    await history.append('session-1', userMessage('message-1', 1_700_000_000_001))
    await history.append('session-1', userMessage('message-2', 1_700_000_000_002))
    await history.append('session-1', userMessage('message-3', 1_700_000_000_003))

    const truncated = await history.truncate('session-1', 'message-2')
    await history.append(
      'session-1',
      userMessage('message-edited', 1_700_000_000_011),
    )

    expect(truncated.map((message) => message.id)).toEqual(['message-1'])
    const allEntries = store.entriesBySession.get('session-1') ?? []
    expect(allEntries.map((entry) => entry.id)).toEqual([
      'message-1',
      'message-2',
      'message-3',
      'truncate-1',
      'message-edited',
    ])
    expect(allEntries[3]).toMatchObject({
      type: 'custom',
      id: 'truncate-1',
      parentId: 'message-3',
      customType: 'tgbuddy.truncate',
      data: {
        fromId: 'message-2',
        reason: 'edit_and_resend',
      },
    })
    expect(allEntries[4]?.parentId).toBe('message-1')

    const reopened = createSessionMessageHistory({
      store,
      createId: () => 'unused',
      now: Date.now,
    })
    expect(
      (await reopened.messages('session-1')).map((message) => message.id),
    ).toEqual(['message-1', 'message-edited'])
  })

  test('压缩后编辑保留消息仍保留摘要，不会重新激活已压缩原文', async () => {
    const store = new MemoryMessageStore()
    const generatedIds = ['compaction-1', 'truncate-1', 'compaction-2']
    const history = createSessionMessageHistory({
      store,
      createId: () => generatedIds.shift() ?? 'unused',
      now: () => 1_700_000_000_010,
    })
    await history.create('session-1', 'C:\\workspace')
    await history.append('session-1', userMessage('message-1', 1))
    await history.append('session-1', userMessage('message-2', 2))
    await history.append('session-1', userMessage('message-3', 3))
    await history.appendCompaction('session-1', {
      summary: '前两条摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 100,
    })

    const truncated = await history.truncate('session-1', 'message-3')
    await history.append('session-1', userMessage('message-edited', 11))

    expect(truncated.map((message) => message.id)).toEqual(['compaction-2'])
    expect((await history.messages('session-1')).map((message) => message.id))
      .toEqual(['compaction-2', 'message-edited'])
    expect(
      (await history.compactedMessages('session-1', 'compaction-2'))
        .map((message) => message.id),
    ).toEqual(['message-1', 'message-2'])
  })

  test('线性截断拒绝非用户消息且不改变 active history', async () => {
    const store = new MemoryMessageStore()
    const history = createSessionMessageHistory({
      store,
      createId: () => 'unused',
      now: Date.now,
    })
    await history.create('session-1', 'C:\\workspace')
    await history.append('session-1', userMessage('message-1', 1))
    const result = successfulWriteMessages(2)[1]!
    await history.append('session-1', result)

    await expect(
      history.truncate('session-1', result.id),
    ).rejects.toThrow('只能从当前历史中的用户消息编辑重发')
    expect(
      (await history.messages('session-1')).map((message) => message.id),
    ).toEqual(['message-1', result.id])
  })

  test('从历史点复制独立前缀，新旧 Session 重启后仍互不影响', async () => {
    const store = new MemoryMessageStore()
    const generatedIds = ['clone-message-1', 'clone-message-2']
    const history = createSessionMessageHistory({
      store,
      createId: () => generatedIds.shift() ?? 'unused',
      now: Date.now,
    })
    await history.create('session-source', 'C:\\workspace')
    await history.append('session-source', userMessage('message-1', 1))
    await history.append('session-source', userMessage('message-2', 2))
    await history.append('session-source', userMessage('message-3', 3))
    const sourceBefore = await history.messages('session-source')

    const cloned = await history.clonePrefix(
      'session-source',
      'session-clone',
      'message-2',
      'C:\\workspace',
    )

    expect(cloned.map((message) => message.id)).toEqual([
      'clone-message-1',
      'clone-message-2',
    ])
    expect(
      cloned.map((message) =>
        message.kind === 'kernel' ? message.message.content : undefined,
      ),
    ).toEqual([
      [{ type: 'text', text: 'message-1' }],
      [{ type: 'text', text: 'message-2' }],
    ])
    expect((await history.messages('session-source')).map((message) => message.id))
      .toEqual(['message-1', 'message-2', 'message-3'])
    const firstSource = sourceBefore[0]
    const firstClone = cloned[0]
    if (
      firstSource?.kind !== 'kernel'
      || firstClone?.kind !== 'kernel'
    ) {
      throw new Error('测试消息类型错误')
    }
    expect(firstClone.message).not.toBe(firstSource.message)

    const reopened = createSessionMessageHistory({
      store,
      createId: () => 'unused',
      now: Date.now,
    })
    expect(
      (await reopened.messages('session-clone')).map((message) => message.id),
    ).toEqual(['clone-message-1', 'clone-message-2'])
    expect(store.kernels.get('session-clone')).toBe(KERNEL_ID)
  })

  test('从压缩后的历史新建会话时复制摘要与保留消息，而不是恢复原文', async () => {
    const store = new MemoryMessageStore()
    const generatedIds = [
      'source-compaction',
      'clone-compaction',
      'clone-kept',
    ]
    const history = createSessionMessageHistory({
      store,
      createId: () => generatedIds.shift() ?? 'unused',
      now: () => 10,
    })
    await history.create('session-source', 'C:\\workspace')
    await history.append('session-source', userMessage('message-1', 1))
    await history.append('session-source', userMessage('message-2', 2))
    await history.append('session-source', userMessage('message-3', 3))
    await history.appendCompaction('session-source', {
      summary: '前两条摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 10_000,
    })

    const cloned = await history.clonePrefix(
      'session-source',
      'session-clone',
      'message-3',
      'C:\\workspace',
    )

    expect(cloned.map((message) => message.id)).toEqual([
      'clone-compaction',
      'clone-kept',
    ])
    expect(cloned[0]).toMatchObject({
      kind: 'compaction',
      summary: '前两条摘要',
      firstKeptEntryId: 'clone-kept',
    })
    expect((await history.messages('session-source')).map((message) => message.id))
      .toEqual(['source-compaction', 'message-3'])
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
        type: 'message',
        id: 'new-message',
        parentId: 'compaction-1',
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
