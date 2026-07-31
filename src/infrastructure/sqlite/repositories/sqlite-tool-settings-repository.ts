import type {
  ToolPermissionSetting,
  ToolSettingsRepository,
} from '../../../runtime/tools/tool-settings-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface ToolSettingRow {
  tool_id: string
  permission: ToolPermissionSetting['permission']
  updated_at: number
}

export class SqliteToolSettingsRepository implements ToolSettingsRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(): ToolPermissionSetting[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(
          `SELECT tool_id, permission, updated_at
           FROM app_tool_settings
           ORDER BY updated_at ASC`,
        )
        .all() as unknown as ToolSettingRow[]
      return rows.map((row) => ({
        toolId: row.tool_id,
        permission: row.permission,
        updatedAt: row.updated_at,
      }))
    })
  }

  set(setting: ToolPermissionSetting): void {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_tool_settings (tool_id, permission, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(tool_id) DO UPDATE SET
             permission = excluded.permission,
             updated_at = excluded.updated_at`,
        )
        .run(setting.toolId, setting.permission, setting.updatedAt)
    })
  }

  remove(toolId: string): void {
    this.#appDatabase.use((database) => {
      database
        .prepare('DELETE FROM app_tool_settings WHERE tool_id = ?')
        .run(toolId)
    })
  }

  clear(): void {
    this.#appDatabase.use((database) => {
      database.exec('DELETE FROM app_tool_settings')
    })
  }
}
