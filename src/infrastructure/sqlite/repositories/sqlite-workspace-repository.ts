import type { Workspace } from '../../../shared/contracts/workspace.ts'
import type { WorkspaceRepository } from '../../../runtime/workspaces/workspace-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface WorkspaceRow {
  id: string
  name: string
  path: string
  resolved_at: number
  created_at: number
  updated_at: number
}

const SELECT_COLUMNS = `
  id,
  name,
  path,
  resolved_at,
  created_at,
  updated_at
`

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    mount: {
      workspaceId: row.id,
      path: row.path,
      resolvedAt: row.resolved_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function workspaceValues(workspace: Workspace): Array<string | number> {
  const mount = workspace.mount
  if (!mount) throw new Error(`Workspace ${workspace.id} 缺少 mount 路径`)
  return [
    workspace.id,
    workspace.name,
    mount.path,
    mount.resolvedAt,
    workspace.createdAt,
    workspace.updatedAt,
  ]
}

/**
 * `app_workspaces` 的 SQLite adapter。与 Session repository 共用同一个
 * AppDatabase 连接，应用退出时只关闭一个 owner。
 */
export class SqliteWorkspaceRepository implements WorkspaceRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(): Workspace[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM app_workspaces
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as unknown as WorkspaceRow[]
      return rows.map(rowToWorkspace)
    })
  }

  get(workspaceId: string): Workspace | undefined {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_workspaces WHERE id = ?`)
        .get(workspaceId) as unknown as WorkspaceRow | undefined
      return row ? rowToWorkspace(row) : undefined
    })
  }

  create(workspace: Workspace): Workspace {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_workspaces (
             id, name, path, resolved_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(...workspaceValues(workspace))
    })
    return this.#require(workspace.id)
  }

  #require(workspaceId: string): Workspace {
    const workspace = this.get(workspaceId)
    if (!workspace) throw new Error(`Workspace 不存在: ${workspaceId}`)
    return workspace
  }
}
