/** Blob 引用（与 runtime 端口同构，供跨进程序列化）。 */
export interface BlobRef {
  hash: string
  size: number
  mime?: string
}
