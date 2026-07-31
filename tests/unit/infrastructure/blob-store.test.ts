import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createNodeFsBlobStore } from '../../../src/infrastructure/blob/index.ts'

function fixture(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'tgbuddy-blob-'))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('NodeFsBlobStore（A01 内容寻址）', () => {
  test('put 后按内容 hash 派生路径，相同内容只存一份（dedupe）', async () => {
    const { root, cleanup } = fixture()
    try {
      const store = createNodeFsBlobStore({ root })
      const first = await store.put(new TextEncoder().encode('hello blob'))
      const second = await store.put(new TextEncoder().encode('hello blob'))

      expect(second.hash).toBe(first.hash)
      expect(second.size).toBe(first.size)
      // 物理只落一份文件，路径由 hash 派生
      const files = readdirSync(root)
      expect(files).toHaveLength(1)
      expect(files[0]).toBe(first.hash)
    } finally {
      cleanup()
    }
  })

  test('get 读回内容并校验 hash 与 size', async () => {
    const { root, cleanup } = fixture()
    try {
      const store = createNodeFsBlobStore({ root })
      const ref = await store.put(new TextEncoder().encode('内容寻址测试'))
      const bytes = await store.get(ref)

      expect(new TextDecoder().decode(bytes)).toBe('内容寻址测试')
      expect(await store.has(ref)).toBe(true)
    } finally {
      cleanup()
    }
  })

  test('文件被篡改后 get 拒绝返回（hash mismatch 视为存储损坏）', async () => {
    const { root, cleanup } = fixture()
    try {
      const store = createNodeFsBlobStore({ root })
      const ref = await store.put(new TextEncoder().encode('原始内容'))
      writeFileSync(join(root, ref.hash), '被篡改的内容', 'utf8')

      await expect(store.get(ref)).rejects.toThrow(/损坏|hash|存储/i)
    } finally {
      cleanup()
    }
  })

  test('不存在的 ref 抛 NOT_FOUND；delete 幂等', async () => {
    const { root, cleanup } = fixture()
    try {
      const store = createNodeFsBlobStore({ root })
      const ghost = { hash: sha256(new TextEncoder().encode('不存在')), size: 9 }

      await expect(store.get(ghost)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await store.delete(ghost)
      expect(existsSync(join(root, ghost.hash))).toBe(false)
    } finally {
      cleanup()
    }
  })

  test('原子写：成功后不留临时文件；父目录自动创建', async () => {
    const { root, cleanup } = fixture()
    try {
      const nested = join(root, 'sub', 'blobs')
      const store = createNodeFsBlobStore({ root: nested })
      const ref = await store.put(new TextEncoder().encode('原子写入'))

      const files = readdirSync(nested)
      expect(files).toEqual([ref.hash])
      expect(readFileSync(join(nested, ref.hash)).toString('utf8')).toBe('原子写入')
    } finally {
      cleanup()
    }
  })

  test('mime 元数据随 ref 返回', async () => {
    const { root, cleanup } = fixture()
    try {
      const store = createNodeFsBlobStore({ root })
      const ref = await store.put(new TextEncoder().encode('图片字节'), { mime: 'image/png' })

      expect(ref.mime).toBe('image/png')
    } finally {
      cleanup()
    }
  })
})
