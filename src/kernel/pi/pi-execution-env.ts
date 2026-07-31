/**
 * pi ExecutionEnv 的 per-run 适配。
 *
 * S03 起每个 Run 在 kernel 层创建独立沙箱环境：两个工作区并行读写互不
 * 串目录，run settled 后 `dispose()` 调用 NodeExecutionEnv.cleanup()
 * 结束该 Run 残留的后台 shell 进程。
 */

import type { ExecutionEnv } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import type {
  RunExecutionEnv,
  RunExecutionEnvFactory,
} from '../../runtime/execution-env/run-execution-env.ts'
import {
  createSandboxPathContext,
  resolveSandboxedPath,
  SandboxPathError,
} from './pi-sandbox.ts'

/** pi 的 Result 约定：不抛异常，错误进返回值 */
type Res<T> = {
  ok: true
  value: T
} | {
  ok: false
  error: { message: string; [k: string]: unknown }
}

function deny(path: string, reason: string): Res<never> {
  return {
    ok: false,
    error: {
      kind: 'PermissionDenied',
      message: `${reason}：${path}`,
      path,
    },
  }
}

/**
 * 包一层沙箱。用 Proxy 而不是逐个方法转发，pi 将来给 ExecutionEnv
 * 加新方法时默认也走校验，不会静默漏掉。
 */
export function createSandboxedEnv(cwd: string): ExecutionEnv {
  const inner = new NodeExecutionEnv({ cwd })
  // canonical 根只算一次：真实文件系统路径在 Run 内不漂移
  const pathContext = createSandboxPathContext(cwd)

  /** 第一个参数是路径的方法，全部要校验 */
  const PATH_METHODS = new Set([
    'absolutePath',
    'readTextFile',
    'readTextLines',
    'readBinaryFile',
    'writeFile',
    'appendFile',
    'fileInfo',
    'listDir',
    'canonicalPath',
    'exists',
    'createDir',
    'remove',
    'rename',
    'copyFile',
  ])

  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function' || typeof prop !== 'string') return value
      if (!PATH_METHODS.has(prop)) return value.bind(target)

      return async (...args: unknown[]) => {
        const path = args[0]
        if (typeof path !== 'string') return value.apply(target, args)
        try {
          resolveSandboxedPath(path, pathContext)
        } catch (error) {
          if (error instanceof SandboxPathError) {
            return deny(path, error.message.split('：')[0] ?? '拒绝访问')
          }
          throw error
        }

        // rename / copyFile 的第二个参数也是路径，一样要校验
        if (
          (prop === 'rename' || prop === 'copyFile')
          && typeof args[1] === 'string'
        ) {
          try {
            resolveSandboxedPath(args[1], pathContext)
          } catch (error) {
            if (error instanceof SandboxPathError) {
              return deny(args[1], '目标路径越界')
            }
            throw error
          }
        }

        return value.apply(target, args)
      }
    },
  }) as ExecutionEnv
}

export class PiRunExecutionEnv implements RunExecutionEnv {
  readonly id: string
  readonly workspaceId: string
  readonly mountPath: string
  readonly env: ExecutionEnv
  readonly #inner: NodeExecutionEnv
  #disposed = false

  constructor(input: {
    id: string
    workspaceId: string
    mountPath: string
  }) {
    this.id = input.id
    this.workspaceId = input.workspaceId
    this.mountPath = input.mountPath
    this.#inner = new NodeExecutionEnv({ cwd: input.mountPath })
    this.env = createSandboxedEnv(input.mountPath)
  }

  get disposed(): boolean {
    return this.#disposed
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    // cleanup() 结束该 Run 残留的后台 shell 子进程，避免跨 Run 泄漏。
    await this.#inner.cleanup()
  }
}

export class PiRunExecutionEnvFactory implements RunExecutionEnvFactory {
  readonly #createId: () => string
  #counter = 0

  constructor(createId: () => string = () => `run-env-${++this.#counter}`) {
    this.#createId = createId
  }

  create(input: {
    workspaceId: string
    mountPath: string
  }): PiRunExecutionEnv {
    return new PiRunExecutionEnv({
      id: this.#createId(),
      workspaceId: input.workspaceId,
      mountPath: input.mountPath,
    })
  }
}
