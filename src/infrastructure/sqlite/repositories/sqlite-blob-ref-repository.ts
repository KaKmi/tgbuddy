import type { BlobRefRepository, BlobRefType } from '../../../runtime/blob/blob-ref-repository.ts'
import type { AppDatabase } from '../app-database.ts'

/**
 * app_blob_refs 的 SQLite 实现。
 * referencedHashes 并入 attachments/artifacts 源表，重启重建引用不会漏。
 */
export class SqliteBlobRefRepository implements BlobRefRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  add(blobHash: string, type: BlobRefType, key: string): void {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          'INSERT INTO app_blob_refs (blob_hash, ref_type, ref_key) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .run(blobHash, type, key)
    })
  }

  removeForSession(sessionId: string): Set<string> {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare('SELECT DISTINCT blob_hash FROM app_blob_refs WHERE ref_key LIKE ?')
        .all(`${sessionId}:%`) as unknown as Array<{ blob_hash: string }>
      database
        .prepare('DELETE FROM app_blob_refs WHERE ref_key LIKE ?')
        .run(`${sessionId}:%`)
      return new Set(rows.map((row) => row.blob_hash))
    })
  }

  referencedHashes(): Set<string> {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(`
          SELECT blob_hash FROM app_blob_refs
          UNION
          SELECT blob_hash FROM app_attachments WHERE blob_hash IS NOT NULL
          UNION
          SELECT blob_hash FROM app_artifacts WHERE blob_hash IS NOT NULL
        `)
        .all() as unknown as Array<{ blob_hash: string }>
      return new Set(rows.map((row) => row.blob_hash))
    })
  }
}
