import type { Channel, ChannelModel } from '../../../shared/contracts/channel.ts'
import type { ChannelRepository } from '../../../runtime/channels/channel-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface ChannelRow {
  id: string
  name: string
  protocol: Channel['protocol']
  base_url: string
  secret_ref: string
  models_json: string
}

const SELECT_COLUMNS = `
  id,
  name,
  protocol,
  base_url,
  secret_ref,
  models_json
`

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    ...(row.secret_ref ? { secretRef: row.secret_ref } : {}),
    models: JSON.parse(row.models_json) as ChannelModel[],
  }
}

/**
 * `app_channels` 的 SQLite adapter。时间戳由本 adapter 内部维护
 * （列表按创建顺序稳定返回），密钥永远只保存 ref。
 */
export class SqliteChannelRepository implements ChannelRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(): Channel[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM app_channels
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as unknown as ChannelRow[]
      return rows.map(rowToChannel)
    })
  }

  get(channelId: string): Channel | undefined {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_channels WHERE id = ?`)
        .get(channelId) as unknown as ChannelRow | undefined
      return row ? rowToChannel(row) : undefined
    })
  }

  save(channel: Channel): Channel {
    const now = Date.now()
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_channels (
             id, name, protocol, base_url, secret_ref, models_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             protocol = excluded.protocol,
             base_url = excluded.base_url,
             secret_ref = excluded.secret_ref,
             models_json = excluded.models_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          channel.id,
          channel.name,
          channel.protocol,
          channel.baseUrl,
          channel.secretRef ?? '',
          JSON.stringify(channel.models),
          now,
          now,
        )
    })
    return this.#require(channel.id)
  }

  delete(channelId: string): void {
    this.#appDatabase.use((database) => {
      database
        .prepare('DELETE FROM app_channels WHERE id = ?')
        .run(channelId)
    })
  }

  #require(channelId: string): Channel {
    const channel = this.get(channelId)
    if (!channel) throw new Error(`渠道不存在: ${channelId}`)
    return channel
  }
}
