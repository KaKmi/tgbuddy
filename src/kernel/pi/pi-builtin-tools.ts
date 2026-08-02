/**
 * 内置工具构造（由 main/tools/index.ts 迁入，C12 删除旧 owner）。
 *
 * read/write/edit/bash 来自 pi agent-core；delete/glob 是自建工具。
 * 回收站能力不能直接依赖 Electron（架构红线），因此通过
 * `trashItem` 端口注入，Composition Root 提供 shell.trashItem。
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionEnv,
} from '@earendil-works/pi-agent-core'
import { SYSTEM_TOOL_PATTERNS } from '../../shared/types/permission.ts'

/** 一次删除超过这个数量就拒绝，防止"一次请求删 500 个"这类事故 */
const BULK_DELETE_THRESHOLD = 50

export interface BuiltinToolsOptions {
  env: ExecutionEnv
  /** 删除保护：默认移入系统回收站（Electron shell.trashItem） */
  trashItem(absPath: string): Promise<void>
}

/**
 * 把 pi 的 `AgentHarnessTool` 绑定成不再需要外部 context 的 `AgentTool`。
 */
function bindContext<T extends object>(tool: AgentHarnessTool<T>, context: T): AgentTool {
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate, context),
  } as AgentTool
}

export function buildBuiltinTools(
  cwd: string,
  options: BuiltinToolsOptions,
): AgentTool[] {
  const context: BuiltinToolsOptions = options

  return [
    bindContext(createReadTool<BuiltinToolsOptions>(), context),
    bindContext(createWriteTool<BuiltinToolsOptions>(), context),
    bindContext(createEditTool<BuiltinToolsOptions>(), context),
    // bash 的 prepare 钩子在命令真正执行前触发，是做纵深防御的正确位置
    bindContext(
      createBashTool<BuiltinToolsOptions>({
        prepare: (execution) => rejectSystemTools(execution.command),
      }),
      context,
    ),
    globTool(cwd, options.env),
    deleteTool(cwd, options),
  ]
}

// ── delete（自己实现：pi 没有，且要接回收站）────────────────────

function deleteTool(cwd: string, options: BuiltinToolsOptions): AgentTool {
  return {
    name: 'delete',
    label: '删除文件',
    description: '删除文件或目录。默认移入系统回收站而不是永久删除，所以误删可以从回收站找回。',
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { description: '要删除的路径列表' }),
    }),
    execute: async (_id, params) => {
      const { paths } = params as { paths: string[] }
      // 路径先经 env 沙箱 canonicalPath：越界/symlink 逃逸在工具执行前被拒。
      const abs: string[] = []
      for (const path of paths) {
        const resolved = await options.env.canonicalPath(path)
        if (!resolved.ok) throw new Error(resolved.error.message)
        abs.push(resolved.value)
      }

      // 批量闸门。权限层已经问过一次，这里防的是"一次请求删 500 个"
      if (abs.length >= BULK_DELETE_THRESHOLD) {
        throw new Error(
          `一次删除 ${abs.length} 个文件超过了批量阈值（${BULK_DELETE_THRESHOLD}），` +
            `请拆成多次，或让用户在设置里调高阈值。`,
        )
      }

      const results: string[] = []
      for (const p of abs) {
        await deleteWithProtection(p, options)
        results.push(`${relative(cwd, p) || p} → 已移入回收站`)
      }

      return {
        content: [{ type: 'text', text: results.join('\n') }],
        details: { paths: abs, action: 'delete', count: abs.length },
      }
    },
  }
}

/**
 * 删除保护 —— 走系统回收站而不是真删。
 * 回收站实现由 Composition Root 注入（Electron shell.trashItem）。
 * 失败时不退化为直接删除。
 */
async function deleteWithProtection(
  absPath: string,
  options: BuiltinToolsOptions,
): Promise<void> {
  if (!existsSync(absPath)) throw new Error(`文件不存在：${absPath}`)
  await options.trashItem(absPath)
}

// ── glob（自己实现：agent-core 里没有）──────────────────────────

function globTool(cwd: string, env: ExecutionEnv): AgentTool {
  return {
    name: 'glob',
    label: '查找文件',
    description: '按文件名模式递归查找文件，返回相对路径列表。只读操作。',
    parameters: Type.Object({
      pattern: Type.String({ description: '文件名模式，如 *.ts' }),
      dir: Type.Optional(Type.String({ description: '起始目录，默认工作区根' })),
    }),
    execute: async (_id, params) => {
      const { pattern, dir } = params as { pattern: string; dir?: string }
      const rootResult = await env.canonicalPath(dir ?? '.')
      if (!rootResult.ok) throw new Error(rootResult.error.message)
      const root = rootResult.value
      const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)

      const found: string[] = []
      walk(root, found, re, 0)

      return {
        content: [
          {
            type: 'text',
            text: found.length ? found.map((f) => relative(cwd, f)).join('\n') : '没有匹配的文件',
          },
        ],
        details: { action: 'read', paths: found, count: found.length },
      }
    },
  }
}

function walk(dir: string, out: string[], re: RegExp, depth: number): void {
  if (depth > 8 || out.length >= 500) return // 深度和数量都要封顶，否则大仓库能跑很久
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
    const full = join(dir, name)
    let isDir: boolean
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) walk(full, out, re, depth + 1)
    else if (re.test(name)) out.push(full)
  }
}

/**
 * ⚠️ **bash 的纵深防御。**
 *
 * 沙箱在 env 层对文件类工具是硬约束，但对 `exec` 只是软约束 ——
 * 任意 shell 命令无法静态解析出会碰哪些文件。
 * 所以这里只挡掉能绕过一切限制的系统级工具，其余靠权限提示把关。
 */
export function rejectSystemTools(command: string): void {
  for (const re of SYSTEM_TOOL_PATTERNS) {
    if (re.test(command)) {
      throw new Error(
        '拒绝执行系统级工具：这类命令（wsl / wmic / sc / reg / schtasks 等）能绕过沙箱限制，已被禁用。',
      )
    }
  }
}
