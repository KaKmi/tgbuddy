import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  buildSessionContext,
  type Session,
} from '@earendil-works/pi-agent-core'
import type { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import type {
  SqliteSessionMetadata,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node'
import {
  KERNEL_ID,
  type PersistedSessionEntry,
} from '../../shared/contracts/message.ts'

export interface PiLegacyImportExpectation {
  sessionId: string
  fingerprint: string
  entryDigest: string
  entryCount: number
}

export interface ExistingPiLegacyImport extends PiLegacyImportExpectation {
  marker?: string
}

export type PiLegacyImportDecision =
  | { action: 'create' | 'skip' | 'rebuild' }
  | { action: 'conflict'; reason: string }

export interface PiLegacyImportInput {
  targetSessionId: string
  legacySessionId: string
  cwd: string
  fingerprint: string
  entryDigest: string
  entries: PersistedSessionEntry[]
  activeMessageIds: string[]
}

export interface PiLegacyImportOutcome {
  action: 'created' | 'skipped' | 'rebuilt'
  sessionId: string
  importedEntries: number
}

export type DecidePiLegacyImport = (
  existing: ExistingPiLegacyImport | undefined,
  expected: PiLegacyImportExpectation,
) => PiLegacyImportDecision

export interface PiLegacySessionImporter {
  importSession(
    input: PiLegacyImportInput,
    decide: DecidePiLegacyImport,
  ): Promise<PiLegacyImportOutcome>
  dispose(): Promise<void>
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

class DefaultPiLegacySessionImporter implements PiLegacySessionImporter {
  readonly #repository: SqliteSessionRepo
  readonly #environment: NodeExecutionEnv
  #disposed = false

  constructor(repository: SqliteSessionRepo, environment: NodeExecutionEnv) {
    this.#repository = repository
    this.#environment = environment
  }

  async importSession(
    input: PiLegacyImportInput,
    decide: DecidePiLegacyImport,
  ): Promise<PiLegacyImportOutcome> {
    if (this.#disposed) throw new Error('PiLegacySessionImporter 已关闭')
    const expected: PiLegacyImportExpectation = {
      sessionId: input.legacySessionId,
      fingerprint: input.fingerprint,
      entryDigest: input.entryDigest,
      entryCount: input.entries.length,
    }
    const existing = (await this.#repository.list())
      .find((metadata) => metadata.id === input.targetSessionId)
    let decision = decide(
      existing ? existingImportMetadata(existing) : undefined,
      expected,
    )

    if (decision.action === 'conflict') {
      throw new Error(`${decision.reason}: ${input.targetSessionId}`)
    }
    if ((decision.action === 'skip' || decision.action === 'rebuild') && existing) {
      const session = await this.#repository.open(existing)
      try {
        const actualEntries = await session.getEntries()
        const prefixState = importedPrefixState(actualEntries, input.entries)
        if (prefixState === 'conflict') {
          throw new Error(`legacy imported prefix 已损坏，拒绝覆盖: ${input.targetSessionId}`)
        }
        decision = {
          action: prefixState === 'complete' ? 'skip' : 'rebuild',
        }
      } finally {
        await cleanupImportedSession(session)
      }
    }

    if (decision.action === 'skip' && existing) {
      await verifyImportedSession(this.#repository, existing, input, true)
      return {
        action: 'skipped',
        sessionId: input.targetSessionId,
        importedEntries: 0,
      }
    }

    const action = decision.action === 'rebuild' ? 'rebuilt' : 'created'
    if (decision.action === 'rebuild') {
      if (!existing) throw new Error(`rebuild 缺少已有 Session: ${input.targetSessionId}`)
      await this.#repository.delete(existing)
    }
    const metadata = await createImportedSession(
      this.#repository,
      input,
    )
    await verifyImportedSession(this.#repository, metadata, input, false)
    return {
      action,
      sessionId: input.targetSessionId,
      importedEntries: input.entries.length,
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#environment.cleanup()
  }
}

function existingImportMetadata(
  metadata: SqliteSessionMetadata,
): ExistingPiLegacyImport {
  const value = metadata.metadata ?? {}
  return {
    marker: typeof value.importer === 'string' ? value.importer : undefined,
    sessionId: typeof value.legacySessionId === 'string' ? value.legacySessionId : '',
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : '',
    entryDigest: typeof value.entryDigest === 'string' ? value.entryDigest : '',
    entryCount: typeof value.entryCount === 'number' ? value.entryCount : -1,
  }
}

function entryIdentityDigest(entries: readonly PersistedSessionEntry[]): string {
  return createHash('sha256')
    .update(entries.map((entry) =>
      JSON.stringify({ id: entry.id, type: entry.type }),
    ).join('\n'))
    .digest('hex')
}

type ImportedPrefixState = 'complete' | 'incomplete' | 'conflict'

function importedPrefixState(
  actualEntries: readonly PersistedSessionEntry[],
  expectedEntries: readonly PersistedSessionEntry[],
): ImportedPrefixState {
  const comparableLength = Math.min(actualEntries.length, expectedEntries.length)
  const actualPrefix = actualEntries.slice(0, comparableLength)
  const expectedPrefix = expectedEntries.slice(0, comparableLength)
  if (
    entryIdentityDigest(actualPrefix) !== entryIdentityDigest(expectedPrefix)
    || !isDeepStrictEqual(actualPrefix, expectedPrefix)
  ) {
    return 'conflict'
  }
  return actualEntries.length < expectedEntries.length ? 'incomplete' : 'complete'
}

async function cleanupImportedSession(
  session: Session<SqliteSessionMetadata>,
): Promise<void> {
  const storage = session.getStorage()
  const cleanup = 'cleanup' in storage ? storage.cleanup : undefined
  if (typeof cleanup !== 'function') {
    throw new Error('SQLite SessionStorage 缺少 cleanup()')
  }
  await cleanup.call(storage)
}

async function verifyImportedSession(
  repository: SqliteSessionRepo,
  metadata: SqliteSessionMetadata,
  input: PiLegacyImportInput,
  allowTail: boolean,
): Promise<void> {
  const session = await repository.open(metadata)
  try {
    const actualEntries = await session.getEntries()
    const actualPrefix = actualEntries.slice(0, input.entries.length)
    if (
      actualEntries.length < input.entries.length
      || (!allowTail && actualEntries.length !== input.entries.length)
      || entryIdentityDigest(actualPrefix) !== input.entryDigest
      || !isDeepStrictEqual(actualPrefix, input.entries)
    ) {
      throw new Error(`legacy Session 持久化 identity 校验失败: ${metadata.id}`)
    }
    const byId = new Map(input.entries.map((entry) => [entry.id, entry]))
    const activeEntries = input.activeMessageIds.map((id) => {
      const entry = byId.get(id)
      if (!entry) throw new Error(`legacy active entry 缺失: ${id}`)
      return entry
    })
    const expectedContext = buildSessionContext(activeEntries)
    if (!allowTail) {
      const actualContext = await session.buildContext()
      if (!isDeepStrictEqual(actualContext.messages, expectedContext.messages)) {
        throw new Error(`legacy Session backend context 校验失败: ${metadata.id}`)
      }
    }
  } finally {
    await cleanupImportedSession(session)
  }
}

async function createImportedSession(
  repository: SqliteSessionRepo,
  input: PiLegacyImportInput,
): Promise<SqliteSessionMetadata> {
  const session = await repository.create({
    id: input.targetSessionId,
    cwd: input.cwd,
    metadata: {
      kernel: KERNEL_ID,
      importer: 'tgbuddy-jsonl-v1',
      legacySessionId: input.legacySessionId,
      fingerprint: input.fingerprint,
      entryDigest: input.entryDigest,
      entryCount: input.entries.length,
    },
  })
  try {
    for (const entry of input.entries) {
      await session.getStorage().appendEntry(entry)
    }
    return await session.getMetadata()
  } finally {
    // append 中途失败时保留半成品，下次启动根据 digest 安全 rebuild。
    await cleanupImportedSession(session)
  }
}

export interface CreatePiLegacySessionImporterOptions {
  databasePath: string
  cwd: string
}

export function createPiLegacySessionImporter(
  options: CreatePiLegacySessionImporterOptions,
): PiLegacySessionImporter {
  if (!piNodeModule || !sqliteBackendModule) {
    throw new Error('PiLegacySessionImporter 只能在 Electron Node 22 runtime 中创建')
  }
  const environment = new piNodeModule.NodeExecutionEnv({ cwd: options.cwd })
  const repository = new sqliteBackendModule.SqliteSessionRepo({
    env: environment,
    sqlite: sqliteBackendModule.createNodeSqliteFactory(),
    databasePath: options.databasePath,
  })
  return new DefaultPiLegacySessionImporter(repository, environment)
}
