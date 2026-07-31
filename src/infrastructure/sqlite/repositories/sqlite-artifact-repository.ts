import type { ArtifactKind, ArtifactRef } from '../../../shared/contracts/artifact.ts'
import type { ArtifactRepository } from '../../../runtime/artifacts/artifact-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface ArtifactRow {
  id: string
  workspace_id: string | null
  session_id: string
  producer_run_id: string | null
  name: string
  path: string
  kind: ArtifactKind
  mime: string | null
  size: number | null
  blob_hash: string | null
  blob_size: number | null
  blob_mime: string | null
  source_skill: string | null
  created_at: number
}

const SELECT_COLUMNS = `
  id, workspace_id, session_id, producer_run_id, name, path, kind, mime, size,
  blob_hash, blob_size, blob_mime, source_skill, created_at
`

function rowToArtifact(row: ArtifactRow): ArtifactRef {
  return {
    id: row.id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    sessionId: row.session_id,
    ...(row.producer_run_id ? { producerRunId: row.producer_run_id } : {}),
    name: row.name,
    path: row.path,
    kind: row.kind,
    ...(row.mime ? { mime: row.mime } : {}),
    ...(row.size !== null ? { size: row.size } : {}),
    ...(row.blob_hash
      ? {
          blob: {
            hash: row.blob_hash,
            size: row.blob_size ?? 0,
            ...(row.blob_mime ? { mime: row.blob_mime } : {}),
          },
        }
      : {}),
    ...(row.source_skill ? { sourceSkill: row.source_skill } : {}),
    createdAt: row.created_at,
  }
}

/** app_artifacts 的 SQLite 实现：索引存 SQLite，工作区文件原地不动。 */
export class SqliteArtifactRepository implements ArtifactRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  save(artifact: ArtifactRef): void {
    this.#appDatabase.use((database) => {
      database
        .prepare(`
          INSERT INTO app_artifacts (
            id, workspace_id, session_id, producer_run_id, name, path, kind, mime, size,
            blob_hash, blob_size, blob_mime, source_skill, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (session_id, path) DO UPDATE SET
            id = excluded.id, workspace_id = excluded.workspace_id,
            producer_run_id = excluded.producer_run_id,
            name = excluded.name, kind = excluded.kind, mime = excluded.mime,
            size = excluded.size, blob_hash = excluded.blob_hash,
            blob_size = excluded.blob_size, blob_mime = excluded.blob_mime,
            source_skill = excluded.source_skill,
            created_at = excluded.created_at
        `)
        .run(
          artifact.id,
          artifact.workspaceId ?? null,
          artifact.sessionId,
          artifact.producerRunId ?? null,
          artifact.name,
          artifact.path ?? null,
          artifact.kind,
          artifact.mime ?? null,
          artifact.size ?? null,
          artifact.blob?.hash ?? null,
          artifact.blob?.size ?? null,
          artifact.blob?.mime ?? null,
          artifact.sourceSkill ?? null,
          artifact.createdAt,
        )
    })
  }

  bySession(sessionId: string): ArtifactRef[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_artifacts WHERE session_id = ? ORDER BY created_at ASC`)
        .all(sessionId) as unknown as ArtifactRow[]
      return rows.map(rowToArtifact)
    })
  }

  count(sessionId: string): number {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare('SELECT COUNT(*) AS count FROM app_artifacts WHERE session_id = ?')
        .get(sessionId) as { count: number }
      return Number(row.count)
    })
  }

  deleteSession(sessionId: string): void {
    this.#appDatabase.use((database) => {
      database.prepare('DELETE FROM app_artifacts WHERE session_id = ?').run(sessionId)
    })
  }
}
