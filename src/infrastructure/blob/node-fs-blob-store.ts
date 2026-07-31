/**
 * BlobStore 的本地文件系统实现（A01）。
 *
 * - 物理路径 = `root/<sha256 hex>`（内容寻址，SQLite 只存 ref）；
 * - 原子写：先写 `*.tmp-<uuid>` 再 rename，失败清理临时文件，不留半文件；
 * - 读回时重新计算 sha256 校验，防篡改/损坏（同长度篡改也拦得住）。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BlobRef, BlobStore } from '../../runtime/blob/blob-store.ts'
import {
  blobCorrupted,
  blobNotFound,
} from '../../runtime/blob/blob-store.ts'

export interface NodeFsBlobStoreOptions {
  /** Blob 物理根目录（如 userData/blobs），不存在时自动创建 */
  root: string
}

export function createNodeFsBlobStore(
  options: NodeFsBlobStoreOptions,
): BlobStore {
  const { root } = options

  const pathOf = (hash: string): string => join(root, hash)

  return {
    async put(bytes, meta) {
      const hash = createHash('sha256').update(bytes).digest('hex')
      const target = pathOf(hash)
      if (!existsSync(target)) {
        // 原子写：同目录临时文件 + rename，rename 在同一文件系统内是原子的
        await mkdir(root, { recursive: true })
        const tmp = `${target}.tmp-${randomUUID()}`
        try {
          await writeFile(tmp, bytes)
          await rename(tmp, target)
        } catch (error) {
          await rm(tmp, { force: true }).catch(() => undefined)
          throw error
        }
      }
      return {
        hash,
        size: bytes.byteLength,
        ...(meta?.mime ? { mime: meta.mime } : {}),
      }
    },

    async get(ref) {
      const target = pathOf(ref.hash)
      if (!existsSync(target)) throw blobNotFound(ref.hash)
      const bytes = new Uint8Array(await readFile(target))
      if (bytes.byteLength !== ref.size) throw blobCorrupted(ref.hash)
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== ref.hash) throw blobCorrupted(ref.hash)
      return bytes
    },

    async has(ref) {
      return existsSync(pathOf(ref.hash))
    },

    async delete(ref) {
      const target = pathOf(ref.hash)
      if (existsSync(target)) {
        // 引用计数（A09）决定「何时删」；这里只负责物理删除，缺失幂等
        await unlink(target)
      }
    },
  }
}
