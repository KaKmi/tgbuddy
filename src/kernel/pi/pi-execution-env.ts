/**
 * pi ExecutionEnv 的 per-run 适配。
 *
 * S03 起每个 Run 在 kernel 层创建独立沙箱环境：两个工作区并行读写互不
 * 串目录，run settled 后 `dispose()` 调用 NodeExecutionEnv.cleanup()
 * 结束该 Run 残留的后台 shell 进程。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ExecutionEnv,
} from '@earendil-works/pi-agent-core'
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
export function createSandboxedEnv(cwd: string, tempRoot = join(cwd, '.tgbuddy-tmp')): ExecutionEnv {
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
  ])

  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function' || typeof prop !== 'string') return value

      // pi 内置工具（如 bash 完整输出）依赖 createTempFile，返回路径必须在沙箱可读范围内
      if (prop === 'createTempDir') {
        return async (prefix?: string): Promise<Res<string>> => {
          try {
            await mkdir(tempRoot, { recursive: true })
            return { ok: true, value: await mkdtemp(join(tempRoot, prefix ?? 'tmp-')) }
          } catch (error) {
            return { ok: false, error: tempFileError(error) }
          }
        }
      }
      if (prop === 'createTempFile') {
        return async (options?: { prefix?: string; suffix?: string }): Promise<Res<string>> => {
          try {
            await mkdir(tempRoot, { recursive: true })
            const dir = await mkdtemp(join(tempRoot, 'tmp-'))
            const filePath = join(
              dir,
              `${options?.prefix ?? ''}${randomUUID()}${options?.suffix ?? ''}`,
            )
            await writeFile(filePath, '')
            return { ok: true, value: filePath }
          } catch (error) {
            return { ok: false, error: tempFileError(error) }
          }
        }
      }
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

        return value.apply(target, args)
      }
    },
  }) as ExecutionEnv
}

/** 临时文件失败按 pi Result 约定返回 { message, ... }，不抛异常 */
function tempFileError(error: unknown): { message: string; [k: string]: unknown } {
  return {
    kind: 'FileError',
    message: error instanceof Error ? error.message : String(error),
  }
}

export class PiRunExecutionEnv implements RunExecutionEnv {
  readonly id: string
  readonly workspaceId: string
  readonly mountPath: string
  readonly env: ExecutionEnv
  readonly #inner: NodeExecutionEnv
  readonly #tempRoot: string
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
    // 每个 Run 用独立临时目录，避免同一工作区并行其他 Run 清理时互相干扰
    this.#tempRoot = join(input.mountPath, '.tgbuddy-tmp', this.id)
    this.env = createSandboxedEnv(input.mountPath, this.#tempRoot)
  }

  get disposed(): boolean {
    return this.#disposed
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    // cleanup() 结束该 Run 残留的后台 shell 子进程，避免跨 Run 泄漏。
    await this.#inner.cleanup()
    try {
      await rm(this.#tempRoot, { recursive: true, force: true })
    } catch (error) {
      console.error(`[execution-env] 临时文件目录清理失败：${this.#tempRoot}`, error)
    }
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
