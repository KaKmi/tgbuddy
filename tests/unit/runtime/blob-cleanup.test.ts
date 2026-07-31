import { describe, expect, test } from 'bun:test'
import { createBlobCleanup } from '../../../src/runtime/blob/blob-cleanup.ts'
import { MemoryBlobRefRepository } from '../../../src/runtime/blob/blob-ref-repository.ts'
import type { BlobRef, BlobStore } from '../../../src/runtime/blob/blob-store.ts'

/** 内存版 BlobStore：只实现 A09 需要的 delete/list（put 不参与本测试）。 */
class FakeBlobStore implements BlobStore {
  readonly #files = new Map<string, Uint8Array>()

  constructor(initial: Record<string, string>) {
    for (const [hash, content] of Object.entries(initial)) {
      this.#files.set(hash, new TextEncoder().encode(content))
    }
  }

  async put(bytes: Uint8Array): Promise<BlobRef> {
    const hash = `fake-${bytes.byteLength}`
    this.#files.set(hash, bytes)
    return { hash, size: bytes.byteLength }
  }

  async get(ref: BlobRef): Promise<Uint8Array> {
    const bytes = this.#files.get(ref.hash)
    if (!bytes) throw new Error(`missing ${ref.hash}`)
    return bytes
  }

  async has(ref: BlobRef): Promise<boolean> {
    return this.#files.has(ref.hash)
  }

  async delete(hash: string): Promise<void> {
    this.#files.delete(hash)
  }

  async list(): Promise<string[]> {
    return [...this.#files.keys()]
  }
}

describe('createBlobCleanup（A09）', () => {
  test('共享 blob：删除一个会话的引用后仍被引用，物理文件保留', async () => {
    const blobs = new FakeBlobStore({ shared: 'x' })
    const refs = new MemoryBlobRefRepository()
    refs.add('shared', 'attachment', 's1:entry:a')
    refs.add('shared', 'attachment', 's2:entry:b')
    const cleanup = createBlobCleanup({
      blobs,
      refs,
      listTmpFiles: async () => [],
      deleteFile: async () => {},
    })

    await cleanup.deleteSession('s1')

    expect((await blobs.list())).toEqual(['shared'])
    expect(refs.referencedHashes().has('shared')).toBe(true)
  })

  test('最后引用删除 → 物理 blob 一起删除', async () => {
    const blobs = new FakeBlobStore({ only: 'x', other: 'y' })
    const refs = new MemoryBlobRefRepository()
    refs.add('only', 'attachment', 's1:entry:a')
    const cleanup = createBlobCleanup({
      blobs,
      refs,
      listTmpFiles: async () => [],
      deleteFile: async () => {},
    })

    await cleanup.deleteSession('s1')

    expect(await blobs.list()).toEqual(['other'])
  })

  test('孤儿扫描：未引用 hash 删除、被引用保留、tmp 清理', async () => {
    const blobs = new FakeBlobStore({ orphan: 'o', kept: 'k' })
    const refs = new MemoryBlobRefRepository()
    refs.add('kept', 'tool-output', 's1:t1')
    const removedTmp: string[] = []
    const cleanup = createBlobCleanup({
      blobs,
      refs,
      listTmpFiles: async () => ['abc.tmp-1'],
      deleteFile: async (name) => {
        removedTmp.push(name)
      },
    })

    const result = await cleanup.sweepOrphans()

    expect(result.removed).toEqual(['orphan'])
    expect(await blobs.list()).toEqual(['kept'])
    expect(result.tmpRemoved).toEqual(['abc.tmp-1'])
  })

  test('删除不存在的 blob 幂等，不抛错', async () => {
    const blobs = new FakeBlobStore({})
    const refs = new MemoryBlobRefRepository()
    refs.add('ghost', 'attachment', 's1:entry:a')
    const cleanup = createBlobCleanup({
      blobs,
      refs,
      listTmpFiles: async () => [],
      deleteFile: async () => {},
    })

    await expect(cleanup.deleteSession('s1')).resolves.toBeUndefined()
  })
})
