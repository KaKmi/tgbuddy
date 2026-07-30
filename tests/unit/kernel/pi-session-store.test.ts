import { describe, expect, test } from 'bun:test'
import {
  InMemorySessionStorage,
  Session,
} from '@earendil-works/pi-agent-core'
import {
  PiSessionStore,
  type PiSessionAdapter,
  type PiSessionRepositoryAdapter,
} from '../../../src/kernel/pi/pi-session-store.ts'
import type { PersistedSessionEntry } from '../../../src/shared/contracts/message.ts'

class MemoryPiSession implements PiSessionAdapter {
  readonly entries: PersistedSessionEntry[] = []
  readonly harness = new Session(new InMemorySessionStorage())
  closeCount = 0
  metadataError: Error | undefined
  leafId: string | null = null
  readonly #beforeAppend: (() => Promise<void>) | undefined
  readonly #beforeClose: (() => Promise<void>) | undefined

  constructor(
    beforeAppend?: () => Promise<void>,
    beforeClose?: () => Promise<void>,
  ) {
    this.#beforeAppend = beforeAppend
    this.#beforeClose = beforeClose
  }

  async metadata(): Promise<Record<string, unknown> | undefined> {
    if (this.metadataError) throw this.metadataError
    return { kernel: 'pi@0.82' }
  }

  async listEntries(): Promise<PersistedSessionEntry[]> {
    return [...this.entries]
  }

  async listActiveEntries(): Promise<PersistedSessionEntry[]> {
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]))
    const branch: PersistedSessionEntry[] = []
    let entryId: string | null | undefined = this.leafId
    while (entryId) {
      const entry = byId.get(entryId)
      if (!entry) break
      branch.unshift(entry)
      entryId = entry.parentId
    }
    return branch
  }

  async appendEntry(entry: PersistedSessionEntry): Promise<void> {
    await this.#beforeAppend?.()
    this.entries.push(entry)
    this.leafId = entry.id
  }

  async moveTo(entryId: string | null): Promise<void> {
    this.leafId = entryId
  }

  harnessSession(): Session {
    return this.harness
  }

  async close(): Promise<void> {
    await this.#beforeClose?.()
    this.closeCount++
  }
}

class MemoryPiRepository implements PiSessionRepositoryAdapter {
  readonly sessions = new Map<string, MemoryPiSession>()
  disposeCount = 0
  openCount = 0
  readonly #createSession: () => MemoryPiSession
  readonly #beforeOpen: (() => Promise<void>) | undefined

  constructor(options: {
    createSession?: () => MemoryPiSession
    beforeOpen?: () => Promise<void>
  } = {}) {
    this.#createSession = options.createSession ?? (() => new MemoryPiSession())
    this.#beforeOpen = options.beforeOpen
  }

  async create(
    sessionId: string,
    _cwd: string,
    _metadata: Record<string, unknown>,
  ): Promise<PiSessionAdapter> {
    if (this.sessions.has(sessionId)) throw new Error(`重复 Session: ${sessionId}`)
    const session = this.#createSession()
    this.sessions.set(sessionId, session)
    return session
  }

  async open(sessionId: string): Promise<PiSessionAdapter | undefined> {
    this.openCount++
    await this.#beforeOpen?.()
    return this.sessions.get(sessionId)
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
  }

  async dispose(): Promise<void> {
    this.disposeCount++
  }
}

interface Deferred {
  promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function userEntry(
  id: string,
  parentId: string | null,
  text: string,
): PersistedSessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: `2026-01-01T00:00:0${id.at(-1)}.000Z`,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: 1,
    },
  }
}

describe('PiSessionStore', () => {
  test('追加后 close/reopen 保留 entry ID、顺序和 compaction', async () => {
    const repository = new MemoryPiRepository()
    const store = new PiSessionStore(repository)
    const first = await store.create({
      sessionId: 'session-a',
      cwd: 'C:\\workspace-a',
      kernel: 'pi@0.82',
    })
    const entries: PersistedSessionEntry[] = [
      userEntry('entry-1', null, '第一条'),
      userEntry('entry-2', 'entry-1', '第二条'),
      {
        type: 'compaction',
        id: 'entry-3',
        parentId: 'entry-2',
        timestamp: '2026-01-01T00:00:03.000Z',
        summary: '摘要',
        firstKeptEntryId: 'entry-2',
        tokensBefore: 100,
      },
    ]
    for (const entry of entries) await first.append(entry)
    await first.close()

    const reopened = await store.open('session-a', 'pi@0.82')
    expect(reopened).toBeDefined()
    expect(await reopened?.entries()).toEqual(entries)

    await store.dispose()
    expect(repository.sessions.get('session-a')?.closeCount).toBe(2)
    expect(repository.disposeCount).toBe(1)
  })

  test('两个 Session 隔离，删除一个不影响另一个', async () => {
    const repository = new MemoryPiRepository()
    const store = new PiSessionStore(repository)
    const sessionA = await store.create({
      sessionId: 'session-a',
      cwd: 'C:\\workspace-a',
      kernel: 'pi@0.82',
    })
    const sessionB = await store.create({
      sessionId: 'session-b',
      cwd: 'C:\\workspace-b',
      kernel: 'pi@0.82',
    })
    await sessionA.append(userEntry('a-entry-1', null, 'A'))
    await sessionB.append(userEntry('b-entry-1', null, 'B'))

    await store.delete('session-a')

    expect(await store.open('session-a', 'pi@0.82')).toBeUndefined()
    expect((await store.open('session-b', 'pi@0.82'))?.entries()).resolves.toEqual([
      userEntry('b-entry-1', null, 'B'),
    ])
    await store.dispose()
  })

  test('activeEntries 与 moveTo 只切换有效路径，不删除审计日志', async () => {
    const repository = new MemoryPiRepository()
    const store = new PiSessionStore(repository)
    const session = await store.create({
      sessionId: 'session-a',
      cwd: 'C:\\workspace-a',
      kernel: 'pi@0.82',
    })
    const first = userEntry('entry-1', null, '第一条')
    const second = userEntry('entry-2', 'entry-1', '第二条')
    await session.append(first)
    await session.append(second)

    await session.moveTo('entry-1')

    expect(await session.activeEntries()).toEqual([first])
    expect(await session.entries()).toEqual([first, second])
    await store.dispose()
  })

  test('close 等待在途 append 完成后再关闭底层连接', async () => {
    const appendGate = deferred()
    const session = new MemoryPiSession(() => appendGate.promise)
    const repository = new MemoryPiRepository({ createSession: () => session })
    const store = new PiSessionStore(repository)
    const managed = await store.create({
      sessionId: 'session-a',
      cwd: 'C:\\workspace-a',
      kernel: 'pi@0.82',
    })

    const append = managed.append(userEntry('entry-1', null, 'A'))
    const close = managed.close()
    await Promise.resolve()
    expect(session.closeCount).toBe(0)

    appendGate.resolve()
    await append
    await close
    expect(session.entries).toHaveLength(1)
    expect(session.closeCount).toBe(1)
    await store.dispose()
  })

  test('并发 open 同一 Session 复用一个 handle', async () => {
    const repository = new MemoryPiRepository()
    const session = new MemoryPiSession()
    repository.sessions.set('session-a', session)
    const store = new PiSessionStore(repository)

    const [first, second] = await Promise.all([
      store.open('session-a', 'pi@0.82'),
      store.open('session-a', 'pi@0.82'),
    ])

    expect(first).toBe(second)
    expect(repository.openCount).toBe(1)
    await store.dispose()
    expect(session.closeCount).toBe(1)
  })

  test('AgentHarness 与消息历史复用同一个 pi Session handle', async () => {
    const repository = new MemoryPiRepository()
    const session = new MemoryPiSession()
    repository.sessions.set('session-a', session)
    const store = new PiSessionStore(repository)

    const first = await store.openHarnessSession('session-a', 'pi@0.82')
    const second = await store.openHarnessSession('session-a', 'pi@0.82')

    expect(first).toBe(session.harness)
    expect(second).toBe(first)
    expect(repository.openCount).toBe(1)
    await store.dispose()
  })

  test('dispose 等待在途 open，并关闭其返回的迟到 handle', async () => {
    const openStarted = deferred()
    const openGate = deferred()
    const session = new MemoryPiSession()
    const repository = new MemoryPiRepository({
      beforeOpen: async () => {
        openStarted.resolve()
        await openGate.promise
      },
    })
    repository.sessions.set('session-a', session)
    const store = new PiSessionStore(repository)

    const opening = store.open('session-a', 'pi@0.82')
    await openStarted.promise
    const disposing = store.dispose()
    openGate.resolve()

    await expect(opening).rejects.toThrow('PiSessionStore 已关闭')
    await disposing
    expect(session.closeCount).toBe(1)
    expect(repository.disposeCount).toBe(1)
  })

  test('open 等待正在关闭的 handle，再返回重新打开的可用 handle', async () => {
    const closeStarted = deferred()
    const closeGate = deferred()
    const session = new MemoryPiSession(undefined, async () => {
      closeStarted.resolve()
      await closeGate.promise
    })
    const repository = new MemoryPiRepository({ createSession: () => session })
    const store = new PiSessionStore(repository)
    const first = await store.create({
      sessionId: 'session-a',
      cwd: 'C:\\workspace-a',
      kernel: 'pi@0.82',
    })

    const closing = first.close()
    await closeStarted.promise
    const reopening = store.open('session-a', 'pi@0.82')
    await Promise.resolve()
    expect(repository.openCount).toBe(0)

    closeGate.resolve()
    await closing
    const reopened = await reopening
    expect(reopened).not.toBe(first)
    await expect(reopened?.entries()).resolves.toEqual([])
    await store.dispose()
  })

  test('重复 dispose 共享同一个完成 Promise', async () => {
    const openStarted = deferred()
    const openGate = deferred()
    const session = new MemoryPiSession()
    const repository = new MemoryPiRepository({
      beforeOpen: async () => {
        openStarted.resolve()
        await openGate.promise
      },
    })
    repository.sessions.set('session-a', session)
    const store = new PiSessionStore(repository)

    const opening = store.open('session-a', 'pi@0.82')
    await openStarted.promise
    const firstDispose = store.dispose()
    const secondDispose = store.dispose()
    expect(secondDispose).toBe(firstDispose)

    let secondSettled = false
    void secondDispose.then(() => {
      secondSettled = true
    })
    await Promise.resolve()
    expect(secondSettled).toBeFalse()

    openGate.resolve()
    await expect(opening).rejects.toThrow('PiSessionStore 已关闭')
    await Promise.all([firstDispose, secondDispose])
    expect(session.closeCount).toBe(1)
    expect(repository.disposeCount).toBe(1)
  })

  test('metadata 读取失败时关闭尚未托管的 handle', async () => {
    const repository = new MemoryPiRepository()
    const session = new MemoryPiSession()
    session.metadataError = new Error('metadata 损坏')
    repository.sessions.set('session-a', session)
    const store = new PiSessionStore(repository)

    await expect(store.open('session-a', 'pi@0.82')).rejects.toThrow('metadata 损坏')
    expect(session.closeCount).toBe(1)
    await store.dispose()
    expect(session.closeCount).toBe(1)
    expect(repository.disposeCount).toBe(1)
  })
})
