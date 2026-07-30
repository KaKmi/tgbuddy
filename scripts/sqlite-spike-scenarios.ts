import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertCondition,
  cleanupSession,
  createSpikeRepo,
  type ScenarioResult,
} from './sqlite-spike-runtime.ts'

const nodeSqlite =
  'bun' in process.versions ? undefined : await import('node:sqlite')

export interface ScenarioContext {
  rootDir: string
  executablePath: string
}

interface SqliteVersionRow {
  version: string
}

interface ScalarRow {
  value: string | number
}

interface NamedRow {
  name: string
}

interface ChildExit {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface CrashChildOptions {
  databasePath: string
  cwd: string
  sessionId: string
  markerPath: string
  minimumCommitted: number
  maximumPlanned: number
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

function passedScenario(
  name: string,
  startedAt: number,
  assertions: number,
  entryCount: number,
  databaseBytes: number,
  walBytes: number,
): ScenarioResult {
  return {
    name,
    durationMs: Date.now() - startedAt,
    assertions,
    entryCount,
    databaseBytes,
    walBytes,
    status: 'passed',
  }
}

export async function runRuntimeScenario(
  _context: ScenarioContext,
): Promise<ScenarioResult> {
  const startedAt = Date.now()
  if (!nodeSqlite) throw new Error('runtime 场景只能在 Electron Node 22 运行')
  const memory = new nodeSqlite.DatabaseSync(':memory:')
  try {
    const row = memory
      .prepare('SELECT sqlite_version() AS version')
      .get() as unknown as SqliteVersionRow
    assertCondition(row.version === process.versions.sqlite, 'SQLite 查询版本与 runtime 不一致')
    assertCondition(typeof nodeSqlite.DatabaseSync === 'function', 'node:sqlite 缺少 DatabaseSync')
    assertCondition(typeof nodeSqlite.backup === 'function', 'node:sqlite 缺少 backup()')
    return passedScenario('runtime', startedAt, 3, 0, 0, 0)
  } finally {
    memory.close()
  }
}

export async function runBootstrapScenario(
  context: ScenarioContext,
): Promise<ScenarioResult> {
  const startedAt = Date.now()
  const cwd = join(context.rootDir, 'bootstrap-workspace')
  const databasePath = join(context.rootDir, 'bootstrap', 'sessions.db')
  const first = createSpikeRepo(databasePath, cwd)
  let assertions = 0
  try {
    const initial = await first.repo.list()
    assertCondition(initial.length === 0, '新 SQLite repo 必须为空')
    assertions++
    const session = await first.repo.create({ id: 'bootstrap', cwd })
    assertCondition(first.pragmaAudit.journalMode?.toLowerCase() === 'wal', 'backend journal_mode 必须为 WAL')
    assertCondition(first.pragmaAudit.synchronous === 2, 'backend synchronous 必须为 FULL(2)')
    assertCondition(first.pragmaAudit.busyTimeout === 5000, 'backend busy_timeout 必须为 5000')
    assertions += 3
    await cleanupSession(session)
  } finally {
    await first.env.cleanup()
  }

  if (!nodeSqlite) throw new Error('bootstrap 场景只能在 Electron Node 22 运行')
  const audit = new nodeSqlite.DatabaseSync(databasePath)
  try {
    const migrations = audit
      .prepare('SELECT id AS value FROM migrations ORDER BY id')
      .all() as unknown as ScalarRow[]
    assertCondition(
      migrations.length === 1 && migrations[0]?.value === '001_initial.sql',
      'migration 必须恰好包含 001_initial.sql',
    )
    assertions++
    const tables = audit
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as unknown as NamedRow[]
    const expectedTables = [
      'branch_entries',
      'entry_materialized',
      'migrations',
      'session_entries',
      'session_materialized',
      'session_sequences',
      'sessions',
    ]
    assertCondition(
      JSON.stringify(tables.map((row) => row.name)) === JSON.stringify(expectedTables),
      `初始表不完整: ${tables.map((row) => row.name).join(',')}`,
    )
    assertions++
    const journal = audit.prepare('PRAGMA journal_mode').get() as unknown as {
      journal_mode: string
    }
    const synchronous = audit.prepare('PRAGMA synchronous').get() as unknown as {
      synchronous: number
    }
    const integrity = audit.prepare('PRAGMA integrity_check').get() as unknown as {
      integrity_check: string
    }
    assertCondition(journal.journal_mode.toLowerCase() === 'wal', 'journal_mode 必须为 WAL')
    assertCondition(synchronous.synchronous === 2, 'synchronous 必须为 FULL(2)')
    assertCondition(integrity.integrity_check === 'ok', 'integrity_check 必须为 ok')
    assertions += 3
  } finally {
    audit.close()
  }

  const reopened = createSpikeRepo(databasePath, cwd)
  try {
    const listed = await reopened.repo.list()
    assertCondition(listed.length === 1 && listed[0]?.id === 'bootstrap', 'reopen 必须找到 bootstrap')
    assertions++
    const session = await reopened.repo.open(listed[0]!)
    await cleanupSession(session)
  } finally {
    await reopened.env.cleanup()
  }

  return passedScenario(
    'bootstrap',
    startedAt,
    assertions,
    0,
    await fileBytes(databasePath),
    await fileBytes(`${databasePath}-wal`),
  )
}

export interface CheckpointResult {
  busy: number
  log: number
  checkpointed: number
  backupPages: number
}

export function validateCheckpointResult(
  row: Pick<CheckpointResult, 'busy' | 'log' | 'checkpointed'>,
): void {
  assertCondition(row.busy === 0, `WAL checkpoint busy=${row.busy}`)
  assertCondition(
    row.checkpointed === row.log,
    `WAL checkpoint 未完成: ${row.checkpointed}/${row.log}`,
  )
}

function messageText(entry: SessionTreeEntry): string | undefined {
  if (entry.type !== 'message' || entry.message.role !== 'user') return undefined
  if (typeof entry.message.content === 'string') return entry.message.content
  const text = entry.message.content.find((block) => block.type === 'text')
  return text?.type === 'text' ? text.text : undefined
}

export function assertContinuousPrefix(
  entries: SessionTreeEntry[],
  expectedPrefix: string,
  minimum: number,
  maximum: number,
): void {
  const values = entries
    .map(messageText)
    .filter((text): text is string => text?.startsWith(expectedPrefix) === true)
    .map((text) => Number(text.slice(expectedPrefix.length)))
  assertCondition(
    values.length >= minimum && values.length <= maximum,
    `业务序号数量超出范围: ${values.length}`,
  )
  assertCondition(
    values.every((value, index) => Number.isInteger(value) && value === index),
    '业务序号不是连续前缀',
  )
  assertCondition(new Set(values).size === values.length, '业务序号存在重复')
}

export async function checkpointAndBackup(
  sourcePath: string,
  backupPath: string,
): Promise<CheckpointResult> {
  if (!nodeSqlite) throw new Error('backup 只能在 Electron Node 22 运行')
  const source = new nodeSqlite.DatabaseSync(sourcePath)
  try {
    const row = source
      .prepare('PRAGMA wal_checkpoint(TRUNCATE)')
      .get() as unknown as Pick<CheckpointResult, 'busy' | 'log' | 'checkpointed'>
    validateCheckpointResult(row)
    const backupPages = await nodeSqlite.backup(source, backupPath)
    return { ...row, backupPages }
  } finally {
    source.close()
  }
}

function indexedUser(prefix: 'A' | 'B' | 'crash', index: number) {
  return {
    role: 'user' as const,
    content: [
      {
        type: 'text' as const,
        text: `${prefix}-${index.toString().padStart(4, '0')}`,
      },
    ],
    timestamp: 1_700_000_000_000 + index,
  }
}

export async function runCrashChild(options: CrashChildOptions): Promise<never> {
  assertCondition(options.minimumCommitted >= 1, 'minimumCommitted 必须为正整数')
  assertCondition(
    options.maximumPlanned > options.minimumCommitted,
    'maximumPlanned 必须大于 minimumCommitted',
  )
  const opened = createSpikeRepo(options.databasePath, options.cwd)
  const metadata = (await opened.repo.list()).find((item) => item.id === options.sessionId)
  assertCondition(metadata, `crash child 找不到 Session: ${options.sessionId}`)
  const session = await opened.repo.open(metadata)
  const markerTempPath = `${options.markerPath}.tmp`
  for (let index = 0; index < options.maximumPlanned; index++) {
    await session.appendMessage(indexedUser('crash', index))
    await writeFile(markerTempPath, String(index), 'utf8')
    await rename(markerTempPath, options.markerPath)
  }

  // child 必须保持 backend 和 WAL 打开，只有父进程的 OS 强杀能结束它。
  return await new Promise<never>(() => undefined)
}

function childExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolvePromise({ code, signal }))
  })
}

async function waitForCommittedMarker(
  markerPath: string,
  minimumCommitted: number,
  child: ChildProcess,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `crash child 在 ready marker 前退出: code=${child.exitCode}, signal=${child.signalCode}`,
      )
    }
    try {
      const value = Number((await readFile(markerPath, 'utf8')).trim())
      if (Number.isInteger(value) && value >= minimumCommitted) return value
    } catch {
      // marker 通过 rename 原子发布；首次出现前短暂不存在是正常状态。
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error(`等待 crash child marker 超时: ${markerPath}`)
}

async function forceKill(child: ChildProcess): Promise<void> {
  assertCondition(child.pid !== undefined, 'crash child 缺少 PID')
  if (process.platform !== 'win32') {
    assertCondition(child.kill('SIGKILL'), 'SIGKILL 未能发送给 crash child')
    return
  }
  const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const result = await childExit(killer)
  assertCondition(result.code === 0, `taskkill 失败: code=${result.code}, signal=${result.signal}`)
}

export async function runCrashRecoveryScenario(
  context: ScenarioContext,
): Promise<ScenarioResult> {
  const startedAt = Date.now()
  const databasePath = join(context.rootDir, 'crash', 'sessions.db')
  const cwd = join(context.rootDir, 'crash-workspace')
  const markerPath = join(context.rootDir, 'crash', 'committed.marker')
  const sessionId = 'crash-session'
  const minimumCommitted = 25
  const maximumPlanned = 100_000
  assertCondition(
    context.executablePath === process.execPath,
    'crash child 必须派生当前 packaged 可执行文件',
  )

  const created = createSpikeRepo(databasePath, cwd)
  try {
    const session = await created.repo.create({ id: sessionId, cwd })
    await cleanupSession(session)
  } finally {
    await created.env.cleanup()
  }

  const childRoot = join(context.rootDir, 'crash-child-electron')
  const child = spawn(process.execPath, [
    '--spike-root',
    childRoot,
    '--report',
    join(context.rootDir, 'crash', 'child-report.json'),
    '--scenario',
    'crash',
    '--child-mode',
    'crash-writer',
    '--database',
    databasePath,
    '--cwd',
    cwd,
    '--session-id',
    sessionId,
    '--marker',
    markerPath,
    '--minimum-committed',
    String(minimumCommitted),
    '--maximum-planned',
    String(maximumPlanned),
  ], {
    env: { ...process.env },
    stdio: 'ignore',
    windowsHide: true,
  })
  const exited = childExit(child)
  try {
    await waitForCommittedMarker(markerPath, minimumCommitted, child)
    assertCondition(child.exitCode === null && child.signalCode === null, '强杀前 child 必须存活')
    await forceKill(child)
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      await forceKill(child)
    }
    await exited.catch(() => undefined)
    throw error
  }
  const exit = await exited
  assertCondition(exit.code !== 0 || exit.signal !== null, 'crash child 不得正常退出')

  const recovered = createSpikeRepo(databasePath, cwd)
  let recoveredCount = 0
  try {
    const metadata = (await recovered.repo.list()).find((item) => item.id === sessionId)
    assertCondition(metadata, '强杀后找不到 crash-session')
    const session = await recovered.repo.open(metadata)
    const entries = await session.getEntries()
    recoveredCount = entries.length
    assertCondition(
      recoveredCount >= minimumCommitted && recoveredCount <= maximumPlanned,
      `恢复数量超出范围: ${recoveredCount}`,
    )
    assertContinuousPrefix(entries, 'crash-', minimumCommitted, maximumPlanned)
    assertCondition(
      (await session.getSessionStats()).messageCount === recoveredCount,
      '强杀恢复后的物化计数不一致',
    )
    await session.appendMessage(indexedUser('crash', recoveredCount))
    await cleanupSession(session)
  } finally {
    await recovered.env.cleanup()
  }

  if (!nodeSqlite) throw new Error('crash audit 只能在 Electron Node 22 运行')
  const audit = new nodeSqlite.DatabaseSync(databasePath)
  try {
    const integrity = audit.prepare('PRAGMA integrity_check').get() as unknown as {
      integrity_check: string
    }
    assertCondition(integrity.integrity_check === 'ok', 'crash recovery integrity_check 必须为 ok')
  } finally {
    audit.close()
  }

  const continued = createSpikeRepo(databasePath, cwd)
  try {
    const metadata = (await continued.repo.list()).find((item) => item.id === sessionId)
    assertCondition(metadata, '继续写入后找不到 crash-session')
    const session = await continued.repo.open(metadata)
    const entries = await session.getEntries()
    assertCondition(entries.length === recoveredCount + 1, '强杀恢复后继续写入的条数不一致')
    assertContinuousPrefix(entries, 'crash-', recoveredCount + 1, recoveredCount + 1)
    await cleanupSession(session)
  } finally {
    await continued.env.cleanup()
  }

  return passedScenario(
    'crash-recovery',
    startedAt,
    10,
    recoveredCount + 1,
    await fileBytes(databasePath),
    await fileBytes(`${databasePath}-wal`),
  )
}

async function runOrderedEntries(context: ScenarioContext): Promise<ScenarioResult> {
  const startedAt = Date.now()
  const databasePath = join(context.rootDir, 'ordered', 'sessions.db')
  const cwd = join(context.rootDir, 'ordered-workspace')
  const created = createSpikeRepo(databasePath, cwd)
  let metadata: Awaited<ReturnType<typeof created.repo.list>>[number]
  try {
    const session = await created.repo.create({ id: 'ordered-a', cwd })
    for (let index = 0; index < 1000; index++) {
      await session.appendMessage(indexedUser('A', index))
    }
    metadata = await session.getMetadata()
    await cleanupSession(session)
  } finally {
    await created.env.cleanup()
  }
  const reopened = createSpikeRepo(databasePath, cwd)
  try {
    const session = await reopened.repo.open(metadata!)
    const entries = await session.getEntries()
    assertCondition(entries.length === 1000, `ordered entries 必须为 1000: ${entries.length}`)
    assertContinuousPrefix(entries, 'A-', 1000, 1000)
    assertCondition(new Set(entries.map((entry) => entry.id)).size === 1000, 'entry ID 必须唯一')
    const stats = await session.getSessionStats()
    assertCondition(stats.messageCount === 1000, '物化 messageCount 必须为 1000')
    await cleanupSession(session)
  } finally {
    await reopened.env.cleanup()
  }
  return passedScenario(
    'ordered-entries',
    startedAt,
    4,
    1000,
    await fileBytes(databasePath),
    await fileBytes(`${databasePath}-wal`),
  )
}

async function runIsolationAndDelete(
  context: ScenarioContext,
): Promise<ScenarioResult[]> {
  const isolationStarted = Date.now()
  const databasePath = join(context.rootDir, 'isolation', 'sessions.db')
  const cwd = join(context.rootDir, 'isolation-workspace')
  const created = createSpikeRepo(databasePath, cwd)
  let metadataA: Awaited<ReturnType<typeof created.repo.list>>[number]
  let metadataB: Awaited<ReturnType<typeof created.repo.list>>[number]
  try {
    const sessionA = await created.repo.create({ id: 'isolation-a', cwd })
    const sessionB = await created.repo.create({ id: 'isolation-b', cwd })
    for (let index = 0; index < 100; index++) {
      await sessionA.appendMessage(indexedUser('A', index))
      await sessionB.appendMessage(indexedUser('B', index))
    }
    metadataA = await sessionA.getMetadata()
    metadataB = await sessionB.getMetadata()
    await cleanupSession(sessionA)
    await cleanupSession(sessionB)
  } finally {
    await created.env.cleanup()
  }

  const reopened = createSpikeRepo(databasePath, cwd)
  const listed = await reopened.repo.list()
  const sessionA = await reopened.repo.open(metadataA!)
  const sessionB = await reopened.repo.open(metadataB!)
  const entriesA = await sessionA.getEntries()
  const entriesB = await sessionB.getEntries()
  assertCondition(listed.length === 2, '隔离数据库必须有两个 Session')
  assertCondition(entriesA.length === 100, `A 必须恰好包含 100 条 entry: ${entriesA.length}`)
  assertCondition(entriesB.length === 100, `B 必须恰好包含 100 条 entry: ${entriesB.length}`)
  assertContinuousPrefix(entriesA, 'A-', 100, 100)
  assertContinuousPrefix(entriesB, 'B-', 100, 100)
  assertCondition(
    entriesA.every((entry) => messageText(entry)?.startsWith('A-') === true),
    'A 只能包含自身的消息 entry',
  )
  assertCondition(
    entriesB.every((entry) => messageText(entry)?.startsWith('B-') === true),
    'B 只能包含自身的消息 entry',
  )
  assertCondition((await sessionA.getSessionStats()).messageCount === 100, 'A 物化计数必须为 100')
  assertCondition((await sessionB.getSessionStats()).messageCount === 100, 'B 物化计数必须为 100')
  await cleanupSession(sessionA)
  await cleanupSession(sessionB)
  const isolationResult = passedScenario(
    'session-isolation',
    isolationStarted,
    9,
    200,
    await fileBytes(databasePath),
    await fileBytes(`${databasePath}-wal`),
  )

  const deleteStarted = Date.now()
  await reopened.repo.delete(metadataA!)
  const afterDelete = await reopened.repo.list()
  assertCondition(
    afterDelete.length === 1 && afterDelete[0]?.id === 'isolation-b',
    'delete 后只能剩 isolation-b',
  )
  let notFound = false
  try {
    await reopened.repo.open(metadataA!)
  } catch (error) {
    notFound = error instanceof Error && error.message.includes('Session not found')
  }
  assertCondition(notFound, 'delete 后 open(A) 必须 not_found')
  const surviving = await reopened.repo.open(metadataB!)
  assertCondition((await surviving.getEntries()).length === 100, 'B 内容不得受 delete 影响')
  await cleanupSession(surviving)
  await reopened.env.cleanup()
  if (!nodeSqlite) throw new Error('delete audit 只能在 Electron Node 22 运行')
  const audit = new nodeSqlite.DatabaseSync(databasePath)
  try {
    const row = audit
      .prepare('SELECT count(*) AS count FROM session_entries WHERE session_id = ?')
      .get('isolation-a') as unknown as { count: number }
    assertCondition(row.count === 0, 'delete 后 A entries 必须不可查询')
  } finally {
    audit.close()
  }
  const deleteResult = passedScenario(
    'delete-cleanup',
    deleteStarted,
    4,
    100,
    await fileBytes(databasePath),
    await fileBytes(`${databasePath}-wal`),
  )
  return [isolationResult, deleteResult]
}

async function runCompaction(context: ScenarioContext): Promise<ScenarioResult> {
  const startedAt = Date.now()
  const databasePath = join(context.rootDir, 'compaction', 'sessions.db')
  const cwd = join(context.rootDir, 'compaction-workspace')
  const created = createSpikeRepo(databasePath, cwd)
  let metadata: Awaited<ReturnType<typeof created.repo.list>>[number]
  try {
    const session = await created.repo.create({ id: 'compaction-a', cwd })
    await session.appendMessage(indexedUser('A', 0))
    const keptId = await session.appendMessage(indexedUser('A', 1))
    await session.appendCompaction('压缩摘要', keptId, 12_000, { compactedCount: 1 })
    await session.appendMessage(indexedUser('A', 2))
    metadata = await session.getMetadata()
    await cleanupSession(session)
  } finally {
    await created.env.cleanup()
  }
  const reopened = createSpikeRepo(databasePath, cwd)
  try {
    const session = await reopened.repo.open(metadata!)
    assertCondition((await session.getEntries()).length === 4, 'compaction 原始 entries 必须保留')
    const contextValue = await session.buildContext()
    const summary = contextValue.messages[0]
    assertCondition(
      summary?.role === 'compactionSummary' &&
        summary.summary === '压缩摘要' &&
        summary.tokensBefore === 12_000,
      'compaction summary 恢复失败',
    )
    const serialized = JSON.stringify(contextValue.messages)
    assertCondition(!serialized.includes('A-0000'), 'context 不得包含被压缩消息')
    assertCondition(serialized.includes('A-0001') && serialized.includes('A-0002'), '保留消息缺失')
    await cleanupSession(session)
  } finally {
    await reopened.env.cleanup()
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${databasePath}${suffix}`
    if ((await fileBytes(path)) === 0) continue
    const moved = `${path}.lock-check`
    await rename(path, moved)
    await rename(moved, path)
  }
  return passedScenario(
    'compaction',
    startedAt,
    4,
    4,
    await fileBytes(databasePath),
    await fileBytes(`${databasePath}-wal`),
  )
}

async function runWalBackupRestore(context: ScenarioContext): Promise<ScenarioResult> {
  const startedAt = Date.now()
  const sourcePath = join(context.rootDir, 'backup', 'source.db')
  const backupPath = join(context.rootDir, 'backup', 'restored.db')
  const cwd = join(context.rootDir, 'backup-workspace')
  const created = createSpikeRepo(sourcePath, cwd)
  let metadataA: Awaited<ReturnType<typeof created.repo.list>>[number]
  let metadataB: Awaited<ReturnType<typeof created.repo.list>>[number]
  let expectedEntriesA = ''
  let expectedEntriesB = ''
  let expectedContextA = ''
  try {
    const sessionA = await created.repo.create({ id: 'backup-a', cwd })
    const sessionB = await created.repo.create({ id: 'backup-b', cwd })
    let keptId = ''
    for (let index = 0; index < 900; index++) {
      const id = await sessionA.appendMessage(indexedUser('A', index))
      if (index === 895) keptId = id
    }
    for (let index = 0; index < 100; index++) {
      await sessionB.appendMessage(indexedUser('B', index))
    }
    await sessionA.appendCompaction('备份摘要', keptId, 20_000, { compactedCount: 895 })
    metadataA = await sessionA.getMetadata()
    metadataB = await sessionB.getMetadata()
    expectedEntriesA = JSON.stringify(await sessionA.getEntries())
    expectedEntriesB = JSON.stringify(await sessionB.getEntries())
    expectedContextA = JSON.stringify(await sessionA.buildContext())
    assertCondition((await fileBytes(`${sourcePath}-wal`)) > 0, 'checkpoint 前 WAL 必须存在')
    await cleanupSession(sessionA)
    await cleanupSession(sessionB)
  } finally {
    await created.env.cleanup()
  }
  const checkpoint = await checkpointAndBackup(sourcePath, backupPath)
  assertCondition(checkpoint.busy === 0 && checkpoint.backupPages > 0, 'backup 必须复制页面')
  const movedDir = join(context.rootDir, 'backup', 'source-moved')
  await mkdir(movedDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${sourcePath}${suffix}`
    if ((await fileBytes(path)) === 0) continue
    await rename(path, join(movedDir, `source.db${suffix}`))
  }

  const restored = createSpikeRepo(backupPath, cwd)
  try {
    const listed = await restored.repo.list()
    assertCondition(listed.length === 2, 'restore 必须包含两个 Session')
    const sessionA = await restored.repo.open(
      listed.find((item) => item.id === metadataA!.id)!,
    )
    const sessionB = await restored.repo.open(
      listed.find((item) => item.id === metadataB!.id)!,
    )
    const restoredEntriesA = await sessionA.getEntries()
    const restoredEntriesB = await sessionB.getEntries()
    assertCondition(restoredEntriesA.length === 901, 'restore A 条数不一致')
    assertCondition(restoredEntriesB.length === 100, 'restore B 条数不一致')
    assertCondition(
      JSON.stringify(restoredEntriesA) === expectedEntriesA,
      'restore A entry 顺序或内容与源库不一致',
    )
    assertCondition(
      JSON.stringify(restoredEntriesB) === expectedEntriesB,
      'restore B entry 顺序或内容与源库不一致',
    )
    const restoredContext = await sessionA.buildContext()
    assertCondition(
      JSON.stringify(restoredContext) === expectedContextA,
      'restore compaction context 与源库不一致',
    )
    assertCondition((await sessionA.getSessionStats()).messageCount === 900, 'restore A 物化计数不一致')
    assertCondition((await sessionB.getSessionStats()).messageCount === 100, 'restore B 物化计数不一致')
    await cleanupSession(sessionA)
    await cleanupSession(sessionB)
  } finally {
    await restored.env.cleanup()
  }
  if (!nodeSqlite) throw new Error('restore audit 只能在 Electron Node 22 运行')
  const audit = new nodeSqlite.DatabaseSync(backupPath)
  try {
    const integrity = audit.prepare('PRAGMA integrity_check').get() as unknown as {
      integrity_check: string
    }
    assertCondition(integrity.integrity_check === 'ok', 'restore integrity_check 必须为 ok')
  } finally {
    audit.close()
  }
  return passedScenario(
    'wal-backup-restore',
    startedAt,
    11,
    1001,
    await fileBytes(backupPath),
    0,
  )
}

export async function runStorageScenarios(
  context: ScenarioContext,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  results.push(await runOrderedEntries(context))
  results.push(...(await runIsolationAndDelete(context)))
  results.push(await runCompaction(context))
  results.push(await runWalBackupRestore(context))
  return results
}
