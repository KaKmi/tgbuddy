import type { Session } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import type { SqliteSessionRepo } from '@earendil-works/pi-storage-sqlite-node'
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

export interface SpikeRepoContext {
  env: NodeExecutionEnv
  repo: SqliteSessionRepo
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
  const env = new NodeExecutionEnv({ cwd })
  const repo = new sqliteBackend.SqliteSessionRepo({
    env,
    sqlite: sqliteBackend.createNodeSqliteFactory(),
    databasePath,
  })
  return { env, repo }
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
