import type { BlobRefRepository } from './blob-ref-repository.ts'
import type { BlobStore } from './blob-store.ts'

export interface BlobCleanup {
  /** 会话删除后清理无引用 Blob：先删引用（事务），再物理删除孤儿。 */
  deleteSession(sessionId: string): Promise<void>
  /** 启动时扫描：清理孤儿 blob + 崩溃残留临时文件。 */
  sweepOrphans(): Promise<{ removed: string[]; tmpRemoved: string[] }>
}

export interface CreateBlobCleanupOptions {
  blobs: BlobStore
  refs: BlobRefRepository
  /** 移除崩溃残留临时文件（BlobStore.list 不返回它们） */
  listTmpFiles(): Promise<string[]>
  deleteFile(fileName: string): Promise<void>
}

/**
 * A09：先更新引用（应用表事务删除），再延迟物理清理；失败可重试（幂等）。
 * 缺失 blob 的删除幂等，不产生诊断噪声以外的副作用。
 */
export function createBlobCleanup(options: CreateBlobCleanupOptions): BlobCleanup {
  return {
    async deleteSession(sessionId) {
      const removedHashes = options.refs.removeForSession(sessionId)
      const referenced = options.refs.referencedHashes()
      for (const hash of removedHashes) {
        if (!referenced.has(hash)) {
          await options.blobs.delete(hash)
        }
      }
    },
    async sweepOrphans() {
      const referenced = options.refs.referencedHashes()
      const removed: string[] = []
      for (const hash of await options.blobs.list()) {
        if (!referenced.has(hash)) {
          await options.blobs.delete(hash)
          removed.push(hash)
        }
      }
      const tmpRemoved: string[] = []
      for (const file of await options.listTmpFiles()) {
        await options.deleteFile(file)
        tmpRemoved.push(file)
      }
      return { removed, tmpRemoved }
    },
  }
}
