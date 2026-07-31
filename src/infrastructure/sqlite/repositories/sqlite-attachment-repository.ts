import type { AttachmentRef } from '../../../shared/contracts/attachment.ts'
import type { AttachmentRepository } from '../../../runtime/attachments/attachment-repository.ts'
import type { AppDatabase } from '../app-database.ts'

/** app_attachments 的 SQLite 实现：按 (session_id, message_id) 挂附件 ref。 */
export class SqliteAttachmentRepository implements AttachmentRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  save(sessionId: string, entryId: string, refs: AttachmentRef[]): void {
    this.#appDatabase.use((database) => {
      const stmt = database.prepare(`
        INSERT INTO app_attachments
          (session_id, message_id, attachment_id, name, size, mime, blob_hash, blob_size, blob_mime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, message_id, attachment_id) DO UPDATE SET
          name = excluded.name, size = excluded.size, mime = excluded.mime,
          blob_hash = excluded.blob_hash, blob_size = excluded.blob_size, blob_mime = excluded.blob_mime
      `)
      for (const ref of refs) {
        stmt.run(
          sessionId,
          entryId,
          ref.id,
          ref.name,
          ref.size,
          ref.mime ?? null,
          ref.blob.hash,
          ref.blob.size,
          ref.blob.mime ?? null,
        )
      }
    })
  }

  byMessage(sessionId: string, entryId: string): AttachmentRef[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(`
          SELECT attachment_id, name, size, mime, blob_hash, blob_size, blob_mime
          FROM app_attachments
          WHERE session_id = ? AND message_id = ?
          ORDER BY rowid
        `)
        .all(sessionId, entryId) as unknown as Array<{
        attachment_id: string
        name: string
        size: number
        mime: string | null
        blob_hash: string
        blob_size: number
        blob_mime: string | null
      }>
      return rows.map((row) => ({
        id: row.attachment_id,
        name: row.name,
        size: row.size,
        ...(row.mime ? { mime: row.mime } : {}),
        blob: {
          hash: row.blob_hash,
          size: row.blob_size,
          ...(row.blob_mime ? { mime: row.blob_mime } : {}),
        },
      }))
    })
  }

  deleteSession(sessionId: string): void {
    this.#appDatabase.use((database) => {
      database.prepare('DELETE FROM app_attachments WHERE session_id = ?').run(sessionId)
    })
  }
}
