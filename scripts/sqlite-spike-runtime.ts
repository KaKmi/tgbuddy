import type { Session } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import type {
  SqliteDatabase,
  SqliteDatabaseFactory,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node'
import { join } from 'node:path'

export interface RuntimeSnapshot {
  isPackaged: boolean
  defaultApp: boolean
  appPath: string
  electron: string
  node: string
  sqlite: string
  hasDatabaseSync: boolean
  hasBackup: boolean
  electronRunAsNode: boolean
}

export interface ScenarioResult {
  name: string
  durationMs: number
  assertions: number
  entryCount: number
  databaseBytes: number
  walBytes: number
  status: 'passed' | 'failed'
  error?: string
}

export interface SpikeReport {
  runtime: RuntimeSnapshot
  scenarios: ScenarioResult[]
  status: 'passed' | 'failed'
  startedAt: string
  finishedAt: string
}

export const REQUIRED_SCENARIOS = [
  'runtime',
  'bootstrap',
  'ordered-entries',
  'session-isolation',
  'crash-recovery',
  'compaction',
  'delete-cleanup',
  'wal-backup-restore',
  'legacy-import',
] as const

export interface SpikeRepoContext {
  env: NodeExecutionEnv
  repo: SqliteSessionRepo
  pragmaAudit: PragmaAudit
}

export interface PragmaAudit {
  journalMode?: string
  synchronous?: number
  busyTimeout?: number
}

interface ClosableStorage {
  cleanup(): Promise<void>
}

interface SqliteBackendModule {
  createNodeSqliteFactory: typeof import('@earendil-works/pi-storage-sqlite-node').createNodeSqliteFactory
  SqliteSessionRepo: typeof import('@earendil-works/pi-storage-sqlite-node').SqliteSessionRepo
}

const sqliteBackend: SqliteBackendModule | undefined =
  'bun' in process.versions
    ? undefined
    : ((await import('@earendil-works/pi-storage-sqlite-node')) as SqliteBackendModule)

function auditedFactory(
  base: SqliteDatabaseFactory,
  audit: PragmaAudit,
): SqliteDatabaseFactory {
  return {
    async open(path: string): Promise<SqliteDatabase> {
      const database = await base.open(path)
      return {
        async exec(sql: string): Promise<void> {
          await database.exec(sql)
          const normalized = sql.trim().toLowerCase()
          if (normalized === 'pragma journal_mode=wal') {
            const row = await database.prepare('PRAGMA journal_mode').get<{ journal_mode: string }>()
            audit.journalMode = row?.journal_mode
          } else if (normalized === 'pragma synchronous=full') {
            const row = await database.prepare('PRAGMA synchronous').get<{ synchronous: number }>()
            audit.synchronous = row?.synchronous
          } else if (normalized === 'pragma busy_timeout=5000') {
            const row = await database.prepare('PRAGMA busy_timeout').get<{ timeout: number }>()
            audit.busyTimeout = row?.timeout
          }
        },
        prepare: (sql: string) => database.prepare(sql),
        transaction: <T>(fn: () => Promise<T>) => database.transaction(fn),
        close: () => database.close(),
      }
    },
  }
}

export function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function assertPackagedRuntime(snapshot: RuntimeSnapshot): void {
  assertCondition(
    snapshot.isPackaged && !snapshot.defaultApp,
    '必须从 packaged Electron 运行',
  )
  assertCondition(
    /(?:^|[\\/])app\.asar$/.test(snapshot.appPath),
    `app.getAppPath() 必须指向 app.asar: ${snapshot.appPath}`,
  )
  assertCondition(!snapshot.electronRunAsNode, '不得设置 ELECTRON_RUN_AS_NODE')
  assertCondition(snapshot.electron === '39.8.10', `Electron 版本不匹配: ${snapshot.electron}`)
  assertCondition(snapshot.node === '22.22.1', `Node 版本不匹配: ${snapshot.node}`)
  assertCondition(snapshot.sqlite === '3.51.2', `SQLite 版本不匹配: ${snapshot.sqlite}`)
  assertCondition(snapshot.hasDatabaseSync, 'node:sqlite 缺少 DatabaseSync')
  assertCondition(snapshot.hasBackup, 'node:sqlite 缺少 backup()')
}

function assertScenarioMetrics(scenario: ScenarioResult): void {
  const metrics = [
    scenario.durationMs,
    scenario.assertions,
    scenario.entryCount,
    scenario.databaseBytes,
    scenario.walBytes,
  ]
  assertCondition(
    metrics.every((value) => Number.isFinite(value) && value >= 0),
    `场景指标无效: ${scenario.name}`,
  )
  assertCondition(
    scenario.status === 'failed' || scenario.error === undefined,
    `passed 场景不得包含 error: ${scenario.name}`,
  )
}

export function assertCompleteSpikeReport(report: SpikeReport): void {
  assertPackagedRuntime(report.runtime)
  for (const critical of ['crash-recovery', 'legacy-import']) {
    if (!report.scenarios.some((scenario) => scenario.name === critical)) {
      throw new Error(`缺少必需场景: ${critical}`)
    }
  }
  for (const name of REQUIRED_SCENARIOS) {
    const count = report.scenarios.filter((scenario) => scenario.name === name).length
    if (count === 0) throw new Error(`缺少必需场景: ${name}`)
    if (count !== 1) throw new Error(`必需场景必须恰好出现一次: ${name}`)
  }
  const names = report.scenarios.map((scenario) => scenario.name)
  assertCondition(
    JSON.stringify(names) === JSON.stringify(REQUIRED_SCENARIOS),
    `场景顺序不一致: ${names.join(',')}`,
  )
  for (const scenario of report.scenarios) {
    assertScenarioMetrics(scenario)
    assertCondition(scenario.status === 'passed', `场景未通过: ${scenario.name}`)
  }
  assertCondition(report.status === 'passed', '完整 Spike report status 必须为 passed')
}

export function renderEvidence(report: SpikeReport): string {
  const rows = report.scenarios
    .map(
      (item) =>
        `| ${item.name} | ${item.status} | ${item.durationMs} | ${item.entryCount} | ${item.databaseBytes} | ${item.walBytes} |`,
    )
    .join('\n')
  return `# SQLite Packaged Electron Spike Evidence

## Baseline
- Git: 4735c9da87d5a8a65e074175b34562efaff4dd83
- Command: bun run spike:sqlite

## Runtime
- app.isPackaged: ${report.runtime.isPackaged}
- ASAR: ${report.runtime.appPath.endsWith('app.asar')}
- Electron: ${report.runtime.electron}
- Node: ${report.runtime.node}
- SQLite: ${report.runtime.sqlite}
- pi storage: 0.82.1

## Scenarios
| Scenario | Result | Duration | Entries | DB bytes | WAL bytes |
|---|---|---:|---:|---:|---:|
${rows}

## Compatibility warnings
- model_change.channelId 以 legacy.model_change 保存，未伪装为 provider。
- truncate 按现有最早截断点语义恢复 active context。

## Verification
- bun run typecheck
- bun test
- bun run build
- bun run spike:sqlite
`
}

export function resolvePackagedExecutable(
  outputDir: string,
  platform: NodeJS.Platform,
): string {
  if (platform === 'win32') return join(outputDir, 'TgBuddySQLiteSpike.exe')
  if (platform === 'darwin') {
    return join(outputDir, 'TgBuddySQLiteSpike.app', 'Contents', 'MacOS', 'TgBuddySQLiteSpike')
  }
  return join(outputDir, 'TgBuddySQLiteSpike')
}

export function createSpikeRepo(databasePath: string, cwd: string): SpikeRepoContext {
  // Bun 目前没有 node:sqlite；pure tests 跳过 backend 加载，
  // 真正 backend 仍由 packaged Electron 的 ESM loader 加载。
  if (!sqliteBackend) throw new Error('SQLite backend 只能在 Electron Node 22 runtime 中使用')
  const pragmaAudit: PragmaAudit = {}
  const env = new NodeExecutionEnv({ cwd })
  const repo = new sqliteBackend.SqliteSessionRepo({
    env,
    sqlite: auditedFactory(sqliteBackend.createNodeSqliteFactory(), pragmaAudit),
    databasePath,
  })
  return { env, repo, pragmaAudit }
}

function isClosableStorage(value: unknown): value is ClosableStorage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cleanup' in value &&
    typeof value.cleanup === 'function'
  )
}

export async function cleanupSession(session: Session): Promise<void> {
  const storage: unknown = session.getStorage()
  if (!isClosableStorage(storage)) throw new Error('SQLite SessionStorage 缺少 cleanup()')
  await storage.cleanup()
}
