/**
 * Env 层路径沙箱 —— pi 内置工具的硬边界。
 *
 * S03 把沙箱从 main/tools 的 sandboxed-env 迁到 kernel/pi：
 * pi 的 `ExecutionEnv` 是文件系统 + Shell 的唯一抽象，包一层等于
 * 给所有工具（含以后新增的）一次性上约束。
 *
 * S04 会把这里升级为 canonical path（realpath/symlink 逃逸拒绝）；
 * 当前与旧 main/tools/sandbox.ts 的 `resolveSafePath` 语义保持一致，
 * 旧 owner 只服务 delete/glob 工具，C12 删除。
 */

import { homedir } from 'node:os'
import {
  isAbsolute,
  normalize,
  relative,
  resolve,
} from 'node:path'

export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxPathError'
  }
}

/** 黑名单优先于工作区白名单：Agent 不能改自己的配置、历史和密钥目录 */
const DENIED_ROOTS = [
  resolve(homedir(), '.ssh'),
  resolve(homedir(), '.aws'),
  resolve(homedir(), '.config'),
  resolve(homedir(), '.tgbuddy'),
]

function isWithin(parent: string, child: string): boolean {
  const rel = relative(normalize(parent), normalize(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function deepestMatch(rules: string[], target: string): string | null {
  let best: string | null = null
  for (const rule of rules) {
    if (!isWithin(rule, target)) continue
    if (best === null || normalize(rule).length > normalize(best).length) {
      best = rule
    }
  }
  return best
}

/**
 * 解析路径并校验边界。必须先 resolve 再比较，不能用字符串前缀判断——
 * `~/work/../../etc/passwd` 字符串上以 `~/work` 开头，解析后完全在别处。
 */
export function resolveSandboxedPath(inputPath: string, cwd: string): string {
  const expanded = inputPath.startsWith('~')
    ? resolve(homedir(), inputPath.slice(1).replace(/^[/\\]/, ''))
    : inputPath
  const abs = normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded))
  const roots = [cwd]

  // 最具体的规则优先：工作区若在 ~/.tgbuddy 之下，挂载白名单仍可读，
  // 但 ~/.tgbuddy 根目录本身仍在黑名单里。
  const deepestAllow = deepestMatch(roots, abs)
  const deepestDeny = deepestMatch(DENIED_ROOTS, abs)
  if (
    deepestDeny !== null
    && (deepestAllow === null || deepestDeny.length > deepestAllow.length)
  ) {
    throw new SandboxPathError(`路径在黑名单内，拒绝访问：${abs}`)
  }
  if (deepestAllow === null) {
    throw new SandboxPathError(`路径超出工作区范围：${abs}`)
  }
  return abs
}
