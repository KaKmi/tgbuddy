/**
 * BlobStore 端口（A01）。
 *
 * 内容寻址存储：相同内容只存一份，路径由内容 hash 派生；
 * SQLite 只存 ref（hash + size + mime），物理文件放本地目录。
 * 后续 A02/A04/A05 的 AttachmentRef / ToolOutputRef / ArtifactRef 都指向这里。
 */
import { TgBuddyError } from '../../shared/errors.ts'

/** Blob 引用：可序列化，SQLite 只存这个（物理路径从 hash 派生，永不落库）。 */
export interface BlobRef {
  /** sha256 hex，同时是物理文件名（内容寻址） */
  hash: string
  size: number
  mime?: string
}

export interface BlobPutMeta {
  mime?: string
}

export interface BlobStore {
  /** 写入内容，返回 ref；相同内容直接复用已存在文件（dedupe）。 */
  put(bytes: Uint8Array, meta?: BlobPutMeta): Promise<BlobRef>
  /** 读回内容并校验 hash/size；文件缺失抛 NOT_FOUND，内容不符抛 STORAGE_DEGRADED。 */
  get(ref: BlobRef): Promise<Uint8Array>
  has(ref: BlobRef): Promise<boolean>
  /** 物理删除；不存在时幂等成功（引用计数在 A09 负责「何时删」）。 */
  delete(ref: BlobRef): Promise<void>
}

export function blobNotFound(hash: string): TgBuddyError {
  return new TgBuddyError({
    code: 'NOT_FOUND',
    message: `Blob 不存在：${hash}`,
    recoverable: true,
  })
}

export function blobCorrupted(hash: string): TgBuddyError {
  return new TgBuddyError({
    code: 'STORAGE_DEGRADED',
    message: `Blob 内容与 hash 不符（存储损坏）：${hash}`,
    recoverable: false,
  })
}
