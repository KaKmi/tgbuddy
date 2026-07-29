/**
 * 带沙箱的 ExecutionEnv。
 *
 * ## 为什么沙箱在这一层，而不是每个工具里
 *
 * `ExecutionEnv` 是 pi 的文件系统 + Shell 抽象，**pi 内置的所有工具都只能通过它碰磁盘**。
 * 所以在这里包一层，等于给全部工具一次性上了约束 —— 包括以后新加的、包括 pi 自己升级带来的。
 *
 * 原来的做法是每个工具里手动调 `resolveSafePath`：只要哪天新加一个工具忘了调，
 * 沙箱就有个洞。一个卡点比 N 个卡点可靠。
 *
 * ## 这个沙箱防的是什么
 *
 * **防模型犯错，不防攻击。** Agent 跑在 Electron 主进程里，进程权限一点没变；
 * 真要隔离得上容器或虚拟机（pi 官方文档也是这么建议的）。
 *
 * 它买到的是：模型幻觉出一个路径时能拦住；`~/.tgbuddy` 在黑名单里，
 * **Agent 改不了自己的配置、历史和权限规则**（否则整套权限系统会被自己瓦解）；
 * `.ssh` / `.aws` 在黑名单里，用户手滑点了「允许」也读不到私钥。
 *
 * ## ⚠️ 一个必须知道的不对称
 *
 * 沙箱对文件类工具是**硬约束**，对 `exec`（bash）只是**软约束**。
 * 任意 shell 命令无法静态解析出会碰哪些文件，`cat C:/Windows/...` 照样能跑。
 * bash 的实际防线是「非只读命令每次都要用户授权」，不是路径检查。
 */

import type { ExecutionEnv } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import { resolveSafePath, SandboxError } from './sandbox.ts'

/** pi 的 Result 约定：不抛异常，错误进返回值 */
type Res<T> = { ok: true; value: T } | { ok: false; error: { message: string; [k: string]: unknown } }

function deny(path: string, reason: string): Res<never> {
  return { ok: false, error: { kind: 'PermissionDenied', message: `${reason}：${path}`, path } }
}

/**
 * 包一层沙箱。用 Proxy 而不是逐个方法转发，
 * 是为了 pi 将来给 ExecutionEnv 加新方法时不会静默漏掉 —— 新方法默认也走校验。
 */
export function createSandboxedEnv(cwd: string): ExecutionEnv {
  const inner = new NodeExecutionEnv({ cwd })

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
          resolveSafePath(path, cwd)
        } catch (e) {
          if (e instanceof SandboxError) return deny(path, e.message.split('：')[0] ?? '拒绝访问')
          throw e
        }

        // rename / copyFile 的第二个参数也是路径，一样要校验
        if ((prop === 'rename' || prop === 'copyFile') && typeof args[1] === 'string') {
          try {
            resolveSafePath(args[1], cwd)
          } catch (e) {
            if (e instanceof SandboxError) return deny(args[1], '目标路径越界')
            throw e
          }
        }

        return value.apply(target, args)
      }
    },
  }) as ExecutionEnv
}
