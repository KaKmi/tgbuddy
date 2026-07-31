import type { BlobRef } from '../contracts/blob.ts'

/**
 * 附件引用（A02）。
 *
 * 选择文件后先把字节写入 BlobStore，消息里只携带这个 ref；
 * Renderer 只拿 name/size/mime/blobRef，不接触 Node 文件系统路径。
 */
export interface AttachmentRef {
  /** 渲染层/消息内稳定 id（uuid） */
  id: string
  /** 原始文件名（仅展示与 MIME 推断） */
  name: string
  size: number
  mime?: string
  /** BlobStore 引用：字节在 BlobStore，SQLite/消息只存 hash */
  blob: BlobRef
}

/** 渲染层待发送附件草稿（已 stage 到 BlobStore，尚未进消息） */
export interface AttachmentDraft {
  ref: AttachmentRef
  /** 已进消息则为 true；取消（×）时据此决定是否删除 blob */
  committed: boolean
}
