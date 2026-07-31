import { accessSync, constants, statSync } from 'node:fs'
import type { WorkspaceMountResolution } from '../../shared/contracts/workspace.ts'
import type { WorkspaceMountResolver } from '../../runtime/workspaces/workspace-mount-resolver.ts'

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

/**
 * Node 文件系统 mount 检查。每次 resolve 都重新 stat + access，
 * 目录恢复后下一次调用立即可用。
 */
export class NodeWorkspaceMountResolver implements WorkspaceMountResolver {
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  resolve(workspaceId: string, path: string): WorkspaceMountResolution {
    let stat
    try {
      stat = statSync(path)
    } catch (error) {
      return {
        ok: false,
        code: isMissing(error) ? 'missing' : 'unreadable',
        path,
      }
    }
    if (!stat.isDirectory()) {
      return { ok: false, code: 'not-directory', path }
    }
    try {
      accessSync(path, constants.R_OK)
    } catch {
      return { ok: false, code: 'unreadable', path }
    }
    return {
      ok: true,
      mount: { workspaceId, path, resolvedAt: this.#now() },
    }
  }
}
