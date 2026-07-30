import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import appBootstrapSql from './migrations/001_app_bootstrap.sql'

interface SqliteModule {
  DatabaseSync: typeof import('node:sqlite').DatabaseSync
}

interface AppMigration {
  id: string
  sql: string
}

interface MigrationRow {
  id: string
}

const sqliteModule: SqliteModule | undefined =
  'bun' in process.versions
    ? undefined
    : ((await import('node:sqlite')) as SqliteModule)

const APP_MIGRATIONS: readonly AppMigration[] = [
  {
    id: '001_app_bootstrap.sql',
    sql: appBootstrapSql,
  },
]

/**
 * TgBuddy app 表的 SQLite 连接。
 *
 * pi backend 会用独立连接管理同一物理文件里的私有表；这里永远只执行
 * `app_*` migration，避免把 pi 的内部 schema 变成产品依赖。
 */
export class AppDatabase {
  readonly databasePath: string
  #database: DatabaseSync | undefined

  private constructor(databasePath: string, database: DatabaseSync) {
    this.databasePath = databasePath
    this.#database = database
  }

  static open(databasePath: string): AppDatabase {
    if (!sqliteModule) {
      throw new Error('AppDatabase 只能在 Electron Node 22 runtime 中使用')
    }

    mkdirSync(dirname(databasePath), { recursive: true })
    const database = new sqliteModule.DatabaseSync(databasePath)
    const appDatabase = new AppDatabase(databasePath, database)
    try {
      appDatabase.#configure()
      appDatabase.#migrate()
      return appDatabase
    } catch (error) {
      database.close()
      throw error
    }
  }

  close(): void {
    this.#database?.close()
    this.#database = undefined
  }

  #configure(): void {
    const database = this.#requireOpen()
    database.exec('PRAGMA journal_mode=WAL')
    database.exec('PRAGMA synchronous=FULL')
    database.exec('PRAGMA busy_timeout=5000')
  }

  #migrate(): void {
    const database = this.#requireOpen()
    // migration 表必须先存在，后续 migration 才能在执行 SQL 前判断是否已应用。
    database.exec(appBootstrapSql)

    for (const migration of APP_MIGRATIONS) {
      const applied = database
        .prepare('SELECT id FROM app_schema_migrations WHERE id = ?')
        .get(migration.id) as MigrationRow | undefined
      if (applied) continue

      database.exec('BEGIN IMMEDIATE')
      try {
        // 另一个进程可能在 BEGIN IMMEDIATE 之前完成同一 migration，锁内必须复查。
        const appliedInsideTransaction = database
          .prepare('SELECT id FROM app_schema_migrations WHERE id = ?')
          .get(migration.id) as MigrationRow | undefined
        if (!appliedInsideTransaction) {
          database.exec(migration.sql)
          database
            .prepare('INSERT INTO app_schema_migrations (id, applied_at) VALUES (?, ?)')
            .run(migration.id, Date.now())
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
  }

  #requireOpen(): DatabaseSync {
    if (!this.#database) throw new Error('AppDatabase 已关闭')
    return this.#database
  }
}
