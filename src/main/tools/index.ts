/**
 * 工具集 —— pi 内置的四个 + 我们自己的两个。
 *
 * ## 为什么用 pi 的而不是自己写
 *
 * pi 自带 `createReadTool` / `createWriteTool` / `createEditTool` / `createBashTool`，
 * 而且实现得比手写的完善：read 处理图片并自动缩放、edit 有专门的 diff 实现、
 * bash 支持后台执行、**而且有 `file-mutation-queue` 把文件修改串行化**。
 *
 * 最后一条是关键：pi 默认 `toolExecution: 'parallel'`，模型可以同时发起两个 edit
 * 打到同一个文件上。自己写的版本没有任何保护，那是个真实的并发 bug。
 *
 * ## 自己保留的两个
 *
 * - `delete` —— pi 没有删除工具。回收站保护是我们独有的，也是性价比最高的安全措施
 * - `glob`   —— agent-core 里没有（find/grep 在 coding-agent 包里，我们不引那个）
 *
 * ## 沙箱在哪
 *
 * **在 `ExecutionEnv` 层**，见 `sandboxed-env.ts`。pi 的工具只能通过 env 碰磁盘，
 * 所以包一层就覆盖全部工具，不用每个工具里记得调校验。
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
  type ExecutionEnv,
} from '@earendil-works/pi-agent-core'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { SYSTEM_TOOL_PATTERNS } from '../../shared/types/permission.ts'
import {
  deleteWithProtection,
  getSandbox,
  needsBulkApproval,
  resolveSafePath,
  SandboxError,
} from './sandbox.ts'
import { createSandboxedEnv } from './sandboxed-env.ts'

interface ToolContext {
  env: ExecutionEnv
}

/**
 * 把 pi 的 `AgentHarnessTool` 适配成裸 `Agent` 能用的 `AgentTool`。
 *
 * 两者只差一个参数：harness 版的 `execute` 多收一个 `context`，
 * 由 `AgentHarness` 每轮注入。我们不用 harness，所以在这里把 context 绑死。
 */
function bindContext<T extends object>(tool: AgentHarnessTool<T>, context: T): AgentTool {
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate, context),
  } as AgentTool
}

export function buildBuiltinTools(cwd: string): AgentTool[] {
  const env = createSandboxedEnv(cwd)
  const context: ToolContext = { env }

  return [
    bindContext(createReadTool<ToolContext>(), context),
    bindContext(createWriteTool<ToolContext>(), context),
    bindContext(createEditTool<ToolContext>(), context),
    // bash 的 prepare 钩子在命令真正执行前触发，是做纵深防御的正确位置
    bindContext(
      createBashTool<ToolContext>({
        prepare: (execution) => rejectSystemTools(execution.command),
      }),
      context,
    ),
    globTool(cwd),
    deleteTool(cwd),
  ]
}

// ── delete（自己实现：pi 没有，且要接回收站）────────────────────

function deleteTool(cwd: string): AgentTool {
  return {
    name: 'delete',
    label: '删除文件',
    description: '删除文件或目录。默认移入系统回收站而不是永久删除，所以误删可以从回收站找回。',
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { description: '要删除的路径列表' }),
    }),
    execute: async (_id, params) => {
      const { paths } = params as { paths: string[] }
      const abs = paths.map((p) => resolveSafePath(p, cwd))

      // 批量闸门。权限层已经问过一次，这里防的是"一次请求删 500 个"
      if (needsBulkApproval(abs.length)) {
        throw new Error(
          `一次删除 ${abs.length} 个文件超过了批量阈值（${getSandbox().bulkDeleteThreshold}），` +
            `请拆成多次，或让用户在设置里调高阈值。`,
        )
      }

      const results: string[] = []
      for (const p of abs) {
        const how = await deleteWithProtection(p)
        results.push(`${relative(cwd, p) || p} → ${how === 'trashed' ? '已移入回收站' : '已删除'}`)
      }

      return {
        content: [{ type: 'text', text: results.join('\n') }],
        details: { paths: abs, action: 'delete', count: abs.length },
      }
    },
  }
}

// ── glob（自己实现：agent-core 里没有）──────────────────────────

function globTool(cwd: string): AgentTool {
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
      const root = resolveSafePath(dir ?? '.', cwd)
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
 *
 * 由 permission-service 在授权前调用。
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

export { SandboxError, existsSync }
