/**
 * 沙箱 —— 路径边界与删除保护。
 *
 * **pi 明确声明不带任何权限系统**，默认以宿主进程权限运行。
 * 所以这一层完全是我们自建的，而且它是最后一道防线：
 * 权限服务管「要不要问用户」，沙箱管「就算用户点了同意，也不能越界」。
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

export interface SandboxConfig {
  /** 允许读写的根目录。空数组 = 只允许工作区 */
  allowedRoots: string[]
  /** 黑名单，优先级高于白名单 */
  deniedPaths: string[]
  /** 删除保护：走回收站而不是真删 */
  useTrash: boolean
  /** 一次删除超过这个数量要额外审批 */
  bulkDeleteThreshold: number
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  allowedRoots: [],
  deniedPaths: [
    // 这些目录被 Agent 写进去基本等于事故
    resolve(homedir(), '.ssh'),
    resolve(homedir(), '.aws'),
    resolve(homedir(), '.config'),
    resolve(homedir(), '.tgbuddy'), // 别让 Agent 改自己的配置和历史
  ],
  useTrash: true,
  bulkDeleteThreshold: 50,
}

let config: SandboxConfig = { ...DEFAULT_SANDBOX }

export function configureSandbox(patch: Partial<SandboxConfig>): void {
  config = { ...config, ...patch }
}

export function getSandbox(): SandboxConfig {
  return config
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

/**
 * 把用户/模型给的路径解析成绝对路径并校验边界。
 *
 * ⚠️ **必须先 resolve 再比较**，不能用字符串前缀判断 ——
 * `~/project/../../etc/passwd` 这种路径字符串上以 `~/project` 开头，
 * 解析之后完全在别处。这是路径沙箱最经典的绕过方式。
 */
export function resolveSafePath(inputPath: string, cwd: string): string {
  const expanded = inputPath.startsWith('~')
    ? resolve(homedir(), inputPath.slice(1).replace(/^[/\\]/, ''))
    : inputPath

  const abs = normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded))
  const roots = config.allowedRoots.length > 0 ? config.allowedRoots : [cwd]

  /**
   * **最具体的规则优先。**
   *
   * 不能简单地「黑名单一律优先」——工作区默认就在 `~/.tgbuddy/workspaces/` 下，
   * 而 `~/.tgbuddy` 整个在黑名单里（防止 Agent 改自己的配置和历史）。
   * 一刀切的话 Agent 在自己的工作区里寸步难行。
   *
   * 所以比较匹配深度：更深（更具体）的那条规则说了算。
   */
  const deepestAllow = deepestMatch(roots, abs)
  const deepestDeny = deepestMatch(config.deniedPaths, abs)

  if (deepestDeny !== null && (deepestAllow === null || deepestDeny.length > deepestAllow.length)) {
    throw new SandboxError(`路径在黑名单内，拒绝访问：${abs}`)
  }
  if (deepestAllow === null) {
    throw new SandboxError(`路径超出工作区范围：${abs}\n允许的范围：${roots.join('、')}`)
  }

  return abs
}

/** 返回命中的最长（最具体）规则，没命中返回 null */
function deepestMatch(rules: string[], target: string): string | null {
  let best: string | null = null
  for (const rule of rules) {
    if (!isWithin(rule, target)) continue
    if (best === null || normalize(rule).length > normalize(best).length) best = rule
  }
  return best
}

/** child 是否在 parent 之内（含相等）。用 relative 而不是 startsWith */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(normalize(parent), normalize(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 删除保护 —— **性价比最高的一条安全措施**。
 *
 * 误删是 Agent 最容易造成的不可逆伤害。走系统回收站之后，
 * 用户至少还有一次后悔的机会。
 *
 * Electron 的 `shell.trashItem` 在三个平台都能用。
 * 动态 import 是为了让这个文件在无 Electron 的环境（测试脚本）里也能加载。
 */
export async function deleteWithProtection(absPath: string): Promise<'trashed' | 'deleted'> {
  if (!existsSync(absPath)) throw new SandboxError(`文件不存在：${absPath}`)

  if (config.useTrash) {
    try {
      const { shell } = await import('electron')
      await shell.trashItem(absPath)
      return 'trashed'
    } catch (e) {
      throw new SandboxError(
        `移入回收站失败：${absPath}。删除保护开启时不会退化为直接删除。原因：${String(e)}`,
      )
    }
  }

  const { rmSync } = await import('node:fs')
  rmSync(absPath, { recursive: true, force: true })
  return 'deleted'
}

/** 一次删多个文件时，超过阈值要额外审批 */
export function needsBulkApproval(count: number): boolean {
  return count >= config.bulkDeleteThreshold
}

/** 目录大小粗估，写入前用来挡住"往一个巨大目录里递归操作"这类事故 */
export function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory()
  } catch {
    return false
  }
}

export { sep as pathSep }
