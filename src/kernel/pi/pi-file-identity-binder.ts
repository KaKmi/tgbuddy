import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path'

export interface FileIdentityInvocation {
  kind: string
  file?: {
    paths: ReadonlyArray<{ canonicalPath: string }>
  }
}

export type FinalPathPolicy = 'must_exist' | 'must_remain_missing'

export interface FileResourceIdentity {
  lexicalPath: string
  realParentPath: string
  fileId?: string
  parentId: string
  mountRevision: string
  finalPathPolicy: FinalPathPolicy
}

export interface FileIdentityBinding {
  resources: readonly FileResourceIdentity[]
}

export class FileIdentityChangedError extends Error {
  readonly code = 'resource_identity_changed'

  constructor(path: string) {
    super(`文件资源身份已变化：${path}`)
  }
}

/**
 * 文件授权不能只绑定路径字符串。这里同时绑定真实父目录与文件 id，
 * 执行前重新核验，从而阻止批准后替换目录、junction 或目标文件。
 */
export class PiFileIdentityBinder {
  readonly #root: string

  private constructor(
    root: string,
    readonly mountRevision: string,
  ) {
    this.#root = root
  }

  static async create(workspaceRoot: string, mountRevision: string): Promise<PiFileIdentityBinder> {
    return new PiFileIdentityBinder(await realpath(workspaceRoot), mountRevision)
  }

  async bind(invocation: FileIdentityInvocation): Promise<FileIdentityBinding | undefined> {
    if (invocation.kind !== 'file' || !invocation.file) return undefined
    return {
      resources: await Promise.all(
        invocation.file.paths.map((path) => this.#capture(path.canonicalPath)),
      ),
    }
  }

  async verify(binding: FileIdentityBinding | undefined): Promise<void> {
    if (!binding) return
    for (const expected of binding.resources) {
      const current = await this.#capture(expected.lexicalPath)
      if (
        current.realParentPath !== expected.realParentPath
        || current.parentId !== expected.parentId
        || current.fileId !== expected.fileId
        || current.finalPathPolicy !== expected.finalPathPolicy
        || current.mountRevision !== expected.mountRevision
      ) {
        throw new FileIdentityChangedError(expected.lexicalPath)
      }
    }
  }

  async #capture(lexicalPath: string): Promise<FileResourceIdentity> {
    const absolute = resolve(lexicalPath)
    const parent = await realpath(dirname(absolute))
    if (!isWithin(this.#root, parent)) throw new FileIdentityChangedError(lexicalPath)
    const parentInfo = await stat(parent)
    const fileInfo = await stat(absolute).catch(() => undefined)
    return {
      lexicalPath: absolute,
      realParentPath: parent,
      parentId: `${parentInfo.dev}:${parentInfo.ino}`,
      ...(fileInfo ? { fileId: `${fileInfo.dev}:${fileInfo.ino}` } : {}),
      mountRevision: this.mountRevision,
      finalPathPolicy: fileInfo ? 'must_exist' : 'must_remain_missing',
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(normalize(parent), normalize(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
