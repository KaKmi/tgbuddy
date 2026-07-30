import type {
  Session,
  SessionTreeEntry,
} from '@earendil-works/pi-agent-core'
import type { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import type {
  SqliteSessionMetadata,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node'
import type { PersistedSessionEntry } from '../../shared/contracts/message.ts'
import type {
  CreateMessageSessionInput,
  MessageSession,
  MessageStore,
} from '../../runtime/sessions/message-store.ts'

export interface PiSessionAdapter {
  metadata(): Promise<Record<string, unknown> | undefined>
  listEntries(): Promise<PersistedSessionEntry[]>
  appendEntry(entry: PersistedSessionEntry): Promise<void>
  close(): Promise<void>
}

export interface PiSessionRepositoryAdapter {
  create(
    sessionId: string,
    cwd: string,
    metadata: Record<string, unknown>,
  ): Promise<PiSessionAdapter>
  open(sessionId: string): Promise<PiSessionAdapter | undefined>
  delete(sessionId: string): Promise<void>
  dispose(): Promise<void>
}

interface ClosableStorage {
  cleanup(): Promise<void>
}

interface PiNodeModule {
  NodeExecutionEnv: typeof import('@earendil-works/pi-agent-core/node').NodeExecutionEnv
}

interface SqliteBackendModule {
  createNodeSqliteFactory: typeof import('@earendil-works/pi-storage-sqlite-node').createNodeSqliteFactory
  SqliteSessionRepo: typeof import('@earendil-works/pi-storage-sqlite-node').SqliteSessionRepo
}

const piNodeModule: PiNodeModule | undefined =
  'bun' in process.versions
    ? undefined
    : ((await import('@earendil-works/pi-agent-core/node')) as PiNodeModule)

const sqliteBackendModule: SqliteBackendModule | undefined =
  'bun' in process.versions
    ? undefined
    : ((await import('@earendil-works/pi-storage-sqlite-node')) as SqliteBackendModule)

function isClosableStorage(value: unknown): value is ClosableStorage {
  return (
    typeof value === 'object'
    && value !== null
    && 'cleanup' in value
    && typeof value.cleanup === 'function'
  )
}

class SqlitePiSessionAdapter implements PiSessionAdapter {
  readonly #session: Session<SqliteSessionMetadata>

  constructor(session: Session<SqliteSessionMetadata>) {
    this.#session = session
  }

  async metadata(): Promise<Record<string, unknown> | undefined> {
    return (await this.#session.getMetadata()).metadata
  }

  listEntries(): Promise<SessionTreeEntry[]> {
    return this.#session.getEntries()
  }

  appendEntry(entry: PersistedSessionEntry): Promise<void> {
    return this.#session.getStorage().appendEntry(entry)
  }

  async close(): Promise<void> {
    const storage: unknown = this.#session.getStorage()
    if (!isClosableStorage(storage)) {
      throw new Error('SQLite SessionStorage 缺少 cleanup()')
    }
    await storage.cleanup()
  }
}

class SqlitePiSessionRepositoryAdapter implements PiSessionRepositoryAdapter {
  readonly #repository: SqliteSessionRepo
  readonly #environment: NodeExecutionEnv

  constructor(repository: SqliteSessionRepo, environment: NodeExecutionEnv) {
    this.#repository = repository
    this.#environment = environment
  }

  async create(
    sessionId: string,
    cwd: string,
    metadata: Record<string, unknown>,
  ): Promise<PiSessionAdapter> {
    return new SqlitePiSessionAdapter(
      await this.#repository.create({ id: sessionId, cwd, metadata }),
    )
  }

  async open(sessionId: string): Promise<PiSessionAdapter | undefined> {
    const metadata = (await this.#repository.list()).find((item) => item.id === sessionId)
    return metadata
      ? new SqlitePiSessionAdapter(await this.#repository.open(metadata))
      : undefined
  }

  async delete(sessionId: string): Promise<void> {
    const metadata = (await this.#repository.list()).find((item) => item.id === sessionId)
    if (metadata) await this.#repository.delete(metadata)
  }

  async dispose(): Promise<void> {
    await this.#environment.cleanup()
  }
}

class ManagedMessageSession implements MessageSession {
  readonly sessionId: string
  readonly kernel: string
  readonly #session: PiSessionAdapter
  readonly #onClose: (session: ManagedMessageSession) => void
  readonly #inFlight = new Set<Promise<unknown>>()
  #closed = false
  #closePromise: Promise<void> | undefined

  get isClosing(): boolean {
    return this.#closed
  }

  constructor(
    sessionId: string,
    kernel: string,
    session: PiSessionAdapter,
    onClose: (session: ManagedMessageSession) => void,
  ) {
    this.sessionId = sessionId
    this.kernel = kernel
    this.#session = session
    this.#onClose = onClose
  }

  entries(): Promise<PersistedSessionEntry[]> {
    this.#requireOpen()
    return this.#track(this.#session.listEntries())
  }

  append(entry: PersistedSessionEntry): Promise<void> {
    this.#requireOpen()
    return this.#track(this.#session.appendEntry(entry))
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = this.#close()
    return this.#closePromise
  }

  async #close(): Promise<void> {
    try {
      await Promise.allSettled([...this.#inFlight])
      await this.#session.close()
    } finally {
      this.#onClose(this)
    }
  }

  #track<T>(operation: Promise<T>): Promise<T> {
    this.#inFlight.add(operation)
    const forget = (): void => {
      this.#inFlight.delete(operation)
    }
    void operation.then(forget, forget)
    return operation
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error(`MessageSession 已关闭: ${this.sessionId}`)
  }
}

/**
 * pi Session repository 的 Runtime adapter。
 *
 * adapter 只管理 session handle 与连接生命周期；entry 保持 pi 原生类型，
 * 不读取或拼接 backend 私有 SQL。
 */
export class PiSessionStore implements MessageStore {
  readonly #repository: PiSessionRepositoryAdapter
  readonly #active = new Map<string, ManagedMessageSession>()
  readonly #sessionLocks = new Map<string, Promise<void>>()
  readonly #storeOperations = new Set<Promise<unknown>>()
  #disposed = false
  #disposePromise: Promise<void> | undefined

  constructor(repository: PiSessionRepositoryAdapter) {
    this.#repository = repository
  }

  create(input: CreateMessageSessionInput): Promise<MessageSession> {
    this.#requireActive()
    return this.#trackStoreOperation(
      this.#withSessionLock(input.sessionId, async () => {
        this.#requireActive()
        if (this.#active.has(input.sessionId)) {
          throw new Error(`MessageSession 已打开: ${input.sessionId}`)
        }
        const session = await this.#repository.create(
          input.sessionId,
          input.cwd,
          { kernel: input.kernel },
        )
        return this.#acceptSession(input.sessionId, input.kernel, session)
      }),
    )
  }

  open(sessionId: string, kernel: string): Promise<MessageSession | undefined> {
    this.#requireActive()
    return this.#trackStoreOperation(
      this.#withSessionLock(sessionId, async () => {
        this.#requireActive()
        const active = this.#active.get(sessionId)
        if (active && active.kernel !== kernel) {
          throw new Error(
            `Session ${sessionId} 的 kernel 不兼容：${active.kernel}`,
          )
        }
        if (active && !active.isClosing) return active
        if (active) {
          await active.close()
          this.#requireActive()
        }
        const session = await this.#repository.open(sessionId)
        if (!session) return undefined
        let metadata: Record<string, unknown> | undefined
        try {
          metadata = await session.metadata()
        } catch (error) {
          return this.#closeRejectedSession(
            session,
            error,
            `Session ${sessionId} metadata 读取失败且连接清理失败`,
          )
        }
        if (metadata?.kernel !== kernel) {
          return this.#closeRejectedSession(
            session,
            new Error(
              `Session ${sessionId} 的 kernel 不兼容：${String(metadata?.kernel ?? 'missing')}`,
            ),
            `Session ${sessionId} kernel 校验失败且连接清理失败`,
          )
        }
        return this.#acceptSession(sessionId, kernel, session)
      }),
    )
  }

  delete(sessionId: string): Promise<void> {
    this.#requireActive()
    return this.#trackStoreOperation(
      this.#withSessionLock(sessionId, async () => {
        this.#requireActive()
        await this.#active.get(sessionId)?.close()
        await this.#repository.delete(sessionId)
      }),
    )
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#disposed = true
    this.#disposePromise = this.#dispose()
    return this.#disposePromise
  }

  async #dispose(): Promise<void> {
    await Promise.allSettled([...this.#storeOperations])
    const closeResults = await Promise.allSettled(
      [...this.#active.values()].map((session) => session.close()),
    )
    this.#active.clear()

    let repositoryError: unknown
    try {
      await this.#repository.dispose()
    } catch (error) {
      repositoryError = error
    }

    const errors = closeResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason as unknown)
    if (repositoryError !== undefined) errors.push(repositoryError)
    if (errors.length > 0) throw new AggregateError(errors, 'PiSessionStore 关闭失败')
  }

  #track(
    sessionId: string,
    kernel: string,
    session: PiSessionAdapter,
  ): ManagedMessageSession {
    const managed = new ManagedMessageSession(sessionId, kernel, session, (closed) => {
      if (this.#active.get(sessionId) === closed) this.#active.delete(sessionId)
    })
    this.#active.set(sessionId, managed)
    return managed
  }

  async #acceptSession(
    sessionId: string,
    kernel: string,
    session: PiSessionAdapter,
  ): Promise<ManagedMessageSession> {
    if (!this.#disposed) return this.#track(sessionId, kernel, session)

    await session.close()
    throw new Error('PiSessionStore 已关闭')
  }

  async #closeRejectedSession(
    session: PiSessionAdapter,
    error: unknown,
    aggregateMessage: string,
  ): Promise<never> {
    try {
      await session.close()
    } catch (closeError) {
      throw new AggregateError([error, closeError], aggregateMessage)
    }
    throw error
  }

  #trackStoreOperation<T>(operation: Promise<T>): Promise<T> {
    this.#storeOperations.add(operation)
    const forget = (): void => {
      this.#storeOperations.delete(operation)
    }
    void operation.then(forget, forget)
    return operation
  }

  async #withSessionLock<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#sessionLocks.get(sessionId) ?? Promise.resolve()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate, () => gate)
    this.#sessionLocks.set(sessionId, tail)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.#sessionLocks.get(sessionId) === tail) {
        this.#sessionLocks.delete(sessionId)
      }
    }
  }

  #requireActive(): void {
    if (this.#disposed) throw new Error('PiSessionStore 已关闭')
  }
}

export interface CreatePiSessionStoreOptions {
  databasePath: string
  cwd: string
}

export function createPiSessionStore(
  options: CreatePiSessionStoreOptions,
): PiSessionStore {
  if (!piNodeModule || !sqliteBackendModule) {
    throw new Error('PiSessionStore 只能在 Electron Node 22 runtime 中创建')
  }

  const environment = new piNodeModule.NodeExecutionEnv({ cwd: options.cwd })
  const repository = new sqliteBackendModule.SqliteSessionRepo({
    env: environment,
    sqlite: sqliteBackendModule.createNodeSqliteFactory(),
    databasePath: options.databasePath,
  })
  return new PiSessionStore(
    new SqlitePiSessionRepositoryAdapter(repository, environment),
  )
}
