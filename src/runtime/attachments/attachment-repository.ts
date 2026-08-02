import type { AttachmentRef } from '../../shared/contracts/attachment.ts'

/**
 * 附件引用持久化端口（A02）。
 *
 * 附件是应用元数据：按 (sessionId, entryId) 挂在用户消息上，
 * 不进入 pi 消息本体（保持信封零翻译）。A09 的引用计数基于这里。
 */
export interface AttachmentRepository {
  /** 覆盖写入：同一 (sessionId, entryId) 幂等（重发/续接场景）。 */
  save(sessionId: string, entryId: string, refs: AttachmentRef[]): void
  /** 按消息取附件，供历史回放还原 chips。 */
  byMessage(sessionId: string, entryId: string): AttachmentRef[]
  /** 会话删除时清理（配合 A09 blob 引用计数）。 */
  deleteSession(sessionId: string): void
}

export class MemoryAttachmentRepository implements AttachmentRepository {
  readonly #rows = new Map<string, AttachmentRef[]>()

  #key(sessionId: string, entryId: string): string {
    return `${sessionId}:${entryId}`
  }

  save(sessionId: string, entryId: string, refs: AttachmentRef[]): void {
    this.#rows.set(this.#key(sessionId, entryId), refs)
  }

  byMessage(sessionId: string, entryId: string): AttachmentRef[] {
    return this.#rows.get(this.#key(sessionId, entryId)) ?? []
  }

  deleteSession(sessionId: string): void {
    for (const key of this.#rows.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.#rows.delete(key)
    }
  }
}
