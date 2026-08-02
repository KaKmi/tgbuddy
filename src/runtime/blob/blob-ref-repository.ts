/**
 * Blob 引用类型：attachments/artifacts/tool-output 各自计数，A09 据此清理。
 * ref_key 约定以 `${sessionId}:` 开头，删除会话时按前缀一次性清理。
 */
export type BlobRefType = 'attachment' | 'artifact' | 'tool-output'

export interface BlobRefRepository {
  add(blobHash: string, type: BlobRefType, key: string): void
  /** 删除一个会话的全部引用，返回被删除引用的 blob hash 集合。 */
  removeForSession(sessionId: string): Set<string>
  /** 当前所有被引用的 hash（SQLite 实现会并入源表，防重建遗漏）。 */
  referencedHashes(): Set<string>
}

export class MemoryBlobRefRepository implements BlobRefRepository {
  readonly #rows = new Map<string, Set<string>>()

  #key(hash: string, type: BlobRefType, key: string): string {
    return `${hash}:${type}:${key}`
  }

  add(blobHash: string, type: BlobRefType, key: string): void {
    const set = this.#rows.get(blobHash) ?? new Set<string>()
    set.add(this.#key(blobHash, type, key))
    this.#rows.set(blobHash, set)
  }

  removeForSession(sessionId: string): Set<string> {
    const removed = new Set<string>()
    for (const [hash, keys] of this.#rows) {
      for (const key of keys) {
        if (key.includes(`:${sessionId}:`)) {
          keys.delete(key)
          removed.add(hash)
        }
      }
      if (keys.size === 0) this.#rows.delete(hash)
    }
    return removed
  }

  referencedHashes(): Set<string> {
    return new Set(this.#rows.keys())
  }
}
