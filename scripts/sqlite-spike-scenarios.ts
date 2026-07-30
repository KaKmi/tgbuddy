import { DatabaseSync, backup } from 'node:sqlite'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertCondition,
  cleanupSession,
  createSpikeRepo,
  type ScenarioResult,
} from './sqlite-spike-runtime.ts'

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
  const memory = new DatabaseSync(':memory:')
  try {
    const row = memory
      .prepare('SELECT sqlite_version() AS version')
      .get() as unknown as SqliteVersionRow
    assertCondition(row.version === process.versions.sqlite, 'SQLite 查询版本与 runtime 不一致')
    assertCondition(typeof DatabaseSync === 'function', 'node:sqlite 缺少 DatabaseSync')
    assertCondition(typeof backup === 'function', 'node:sqlite 缺少 backup()')
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

  const audit = new DatabaseSync(databasePath)
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
