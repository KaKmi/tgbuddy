import type { Profile } from '../../../shared/contracts/profile.ts'
import type { ProfileRepository } from '../../../runtime/profiles/profile-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface ProfileRow {
  id: string
  name: string
  channel_id: string
  model_id: string
  system_prompt: string
  skill_ids_json: string | null
  created_at: number
  updated_at: number
}

const SELECT_COLUMNS = `
  id,
  name,
  channel_id,
  model_id,
  system_prompt,
  skill_ids_json,
  created_at,
  updated_at
`

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    channelId: row.channel_id,
    modelId: row.model_id,
    ...(row.system_prompt ? { systemPrompt: row.system_prompt } : {}),
    ...(row.skill_ids_json !== null
      ? { skillIds: parseSkillIds(row.skill_ids_json) }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SqliteProfileRepository implements ProfileRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(): Profile[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM app_profiles
           ORDER BY created_at ASC, id ASC`,
        )
        .all() as unknown as ProfileRow[]
      return rows.map(rowToProfile)
    })
  }

  get(profileId: string): Profile | undefined {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_profiles WHERE id = ?`)
        .get(profileId) as unknown as ProfileRow | undefined
      return row ? rowToProfile(row) : undefined
    })
  }

  save(profile: Profile): Profile {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_profiles (
             id, name, channel_id, model_id, system_prompt, skill_ids_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             channel_id = excluded.channel_id,
             model_id = excluded.model_id,
             system_prompt = excluded.system_prompt,
             skill_ids_json = excluded.skill_ids_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          profile.id,
          profile.name,
          profile.channelId,
          profile.modelId,
          profile.systemPrompt ?? '',
          profile.skillIds === undefined ? null : JSON.stringify(profile.skillIds),
          profile.createdAt,
          profile.updatedAt,
        )
    })
    return this.#require(profile.id)
  }

  delete(profileId: string): void {
    this.#appDatabase.use((database) => {
      database.prepare('DELETE FROM app_profiles WHERE id = ?').run(profileId)
    })
  }

  #require(profileId: string): Profile {
    const profile = this.get(profileId)
    if (!profile) throw new Error(`Profile 不存在: ${profileId}`)
    return profile
  }
}

function parseSkillIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
