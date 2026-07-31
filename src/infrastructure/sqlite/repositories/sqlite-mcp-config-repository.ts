import type { McpServerConfig } from '../../../shared/contracts/mcp.ts'
import type { McpConfigRepository } from '../../../runtime/mcp/mcp-config-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface McpServerRow {
  id: string
  name: string
  transport: McpServerConfig['transport']
  command: string
  args_json: string
  url: string
  env_json: string
  enabled: number
  created_at: number
  updated_at: number
}

const SELECT_COLUMNS = `
  id, name, transport, command, args_json, url, env_json,
  enabled, created_at, updated_at
`

function rowToConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    ...(row.command ? { command: row.command } : {}),
    args: JSON.parse(row.args_json) as string[],
    ...(row.url ? { url: row.url } : {}),
    env: JSON.parse(row.env_json) as Record<string, string>,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SqliteMcpConfigRepository implements McpConfigRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(): McpServerConfig[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM app_mcp_servers
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as unknown as McpServerRow[]
      return rows.map(rowToConfig)
    })
  }

  get(serverId: string): McpServerConfig | undefined {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_mcp_servers WHERE id = ?`)
        .get(serverId) as unknown as McpServerRow | undefined
      return row ? rowToConfig(row) : undefined
    })
  }

  save(config: McpServerConfig): McpServerConfig {
    const now = Date.now()
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_mcp_servers (
             id, name, transport, command, args_json, url, env_json,
             enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             transport = excluded.transport,
             command = excluded.command,
             args_json = excluded.args_json,
             url = excluded.url,
             env_json = excluded.env_json,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
        )
        .run(
          config.id,
          config.name,
          config.transport,
          config.command ?? '',
          JSON.stringify(config.args ?? []),
          config.url ?? '',
          JSON.stringify(config.env ?? {}),
          config.enabled ? 1 : 0,
          now,
          now,
        )
    })
    return this.#require(config.id)
  }

  delete(serverId: string): void {
    this.#appDatabase.use((database) => {
      database.prepare('DELETE FROM app_mcp_servers WHERE id = ?').run(serverId)
    })
  }

  #require(serverId: string): McpServerConfig {
    const config = this.get(serverId)
    if (!config) throw new Error(`MCP 服务不存在: ${serverId}`)
    return config
  }
}
