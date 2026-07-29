/**
 * 权限服务 —— 把一个异步调用挂起，跨 IPC 边界等用户点击。
 *
 * ## 核心手法
 *
 * `Map<requestId, { resolve, request }>` —— 把 Promise 的 `resolve` 函数存起来。
 * pi 的 `beforeToolCall` 是 `await` 的，所以我们返回一个永不自己 settle 的 Promise，
 * agent loop 就真的挂在那里，直到用户在界面上点了按钮、IPC 回来调用 resolve。
 *
 * ## 三个逃生口，一个都不能少
 *
 * 1. **AbortSignal** —— 用户点停止时自动拒绝，否则 Promise 挂死、agent 永远不结束
 * 2. **会话结束** —— `clearSession()` 批量拒绝该会话所有挂起请求
 * 3. **渲染进程重载** —— `getPending()` 让 UI 刷新后能把挂起的请求捞回来
 *
 * 少任何一个，都会出现「界面上没有任何提示，但 Agent 卡住不动」。
 */

import { join } from 'node:path'
import { DATA_DIR, ensureDataDir } from './channel-store.ts'
import { PendingRequests } from './pending-request.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file.ts'
import {
  isNeverPersist,
  isReadOnlyCommand,
  type PermissionMode,
  type PermissionRequest,
  type PermissionResponse,
  type PermissionRule,
  type RiskLevel,
  type RuleMatch,
} from '../shared/types/permission.ts'

/** beforeToolCall 的返回值语义：undefined = 放行 */
export type Verdict = { block: true; reason: string } | undefined

/**
 * 挂起中的授权请求。三个逃生口由 PendingRequests 统一保证 ——
 * 见 pending-request.ts 的说明。
 */
const pending = new PendingRequests<PermissionRequest, Verdict>(
  () => ({ block: true, reason: '操作已中止' }),
  () => ({ block: true, reason: '会话已结束' }),
)
/** sessionId → 权限模式 */
const modes = new Map<string, PermissionMode>()

// ── 规则持久化 ────────────────────────────────────────────────────
// 规则是用户「总是允许」攒出来的资产，重启丢掉等于让用户重新点一遍。

const RULES_FILE = join(DATA_DIR, 'permissions.json')

interface RulesFile {
  version: number
  rules: PermissionRule[]
}

let rules: PermissionRule[] | null = null

function loadRules(): PermissionRule[] {
  if (rules) return rules
  const parsed = readJsonFileSafe<RulesFile>(RULES_FILE)
  rules = Array.isArray(parsed?.rules) ? parsed.rules : []
  return rules
}

function saveRules(): void {
  ensureDataDir()
  writeJsonFileAtomic(RULES_FILE, { version: 1, rules: loadRules() })
}

export type RequestSender = (request: PermissionRequest) => void

// ── 模式 ──────────────────────────────────────────────────────────

export function getMode(sessionId: string): PermissionMode {
  return modes.get(sessionId) ?? 'auto'
}

export function setMode(sessionId: string, mode: PermissionMode): void {
  modes.set(sessionId, mode)
}

// ── 规则 ──────────────────────────────────────────────────────────

export function addRule(rule: Omit<PermissionRule, 'createdAt' | 'hits'>): void {
  if (rule.neverPersist) return // 破坏性操作不入库，静默忽略
  loadRules().push({ ...rule, createdAt: Date.now(), hits: 0 })
  saveRules()
}

export function listRules(): PermissionRule[] {
  return loadRules().slice()
}

export function removeRule(pattern: string, tool: string): void {
  const list = loadRules()
  const i = list.findIndex((r) => r.pattern === pattern && r.tool === tool)
  if (i === -1) return
  list.splice(i, 1)
  saveRules()
}

/**
 * 会话结束时清掉 scope=session 的规则。
 * project / global 的留着 —— 那是用户攒下来的资产。
 */
export function expireSessionRules(sessionId: string): void {
  const list = loadRules()
  const before = list.length
  const kept = list.filter((r) => !(r.scope === 'session' && r.ownerId === sessionId))
  if (kept.length === before) return
  rules = kept
  saveRules()
}

function matchRule(
  rule: PermissionRule,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (rule.tool !== toolName) return false

  switch (rule.match) {
    case 'tool':
      return true
    case 'path': {
      const p = extractPath(args)
      return p !== undefined && globMatch(rule.pattern, p)
    }
    case 'prefix': {
      const cmd = typeof args.command === 'string' ? args.command : ''
      return cmd.startsWith(rule.pattern)
    }
    case 'method':
      return toolName === rule.pattern
  }
}

/** 极简 glob：只支持 `**` 和 `*`，够用且没有依赖 */
function globMatch(pattern: string, path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  const expanded = pattern.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? '~')
  const re = new RegExp(
    `^${expanded
      .replace(/\\/g, '/')
      .replace(/[.+^${}()|[\]]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  )
  return re.test(normalized)
}

function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'file_path', 'filePath']) {
    const v = args[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

// ── 判定 ──────────────────────────────────────────────────────────

const READONLY_TOOLS = new Set(['read', 'glob', 'grep', 'web_search'])
const CONTROL_TOOLS = new Set(['enter_plan_mode', 'exit_plan_mode', 'ask_user'])

export function isControlTool(toolName: string): boolean {
  return CONTROL_TOOLS.has(toolName)
}

function assessRisk(toolName: string, args: Record<string, unknown>): RiskLevel {
  if (READONLY_TOOLS.has(toolName)) return 'low'
  if (toolName === 'bash') {
    const cmd = typeof args.command === 'string' ? args.command : ''
    return isNeverPersist('bash', args) ? 'high' : isReadOnlyCommand(cmd) ? 'low' : 'medium'
  }
  if (toolName === 'delete') return 'high'
  return 'medium' // write / edit
}

/** 给 UI 的候选粒度。用户从中选一个，决定规则怎么建 */
function suggestGrants(
  toolName: string,
  args: Record<string, unknown>,
): PermissionRequest['suggestedGrants'] {
  const out: PermissionRequest['suggestedGrants'] = []
  const path = extractPath(args)

  if (path) {
    const dir = path.replace(/[/\\][^/\\]*$/, '')
    out.push({ match: 'path', pattern: `${dir}/**`, label: `放行 ${dir} 目录下的操作` })
  }
  if (toolName === 'bash' && typeof args.command === 'string') {
    const prefix = args.command.trim().split(/\s+/).slice(0, 2).join(' ')
    out.push({ match: 'prefix', pattern: prefix, label: `放行以「${prefix}」开头的命令` })
  }
  out.push({ match: 'tool', pattern: toolName, label: `放行全部 ${toolName} 调用` })
  return out
}

/**
 * 构造 pi 的 `beforeToolCall` 钩子。
 *
 * @param sessionId 当前会话
 * @param send      把请求推给渲染进程
 */
export function createBeforeToolCall(sessionId: string, send: RequestSender) {
  return async (
    ctx: { toolCall: { id: string; name: string }; args: unknown },
    signal?: AbortSignal,
  ): Promise<Verdict> => {
    const toolName = ctx.toolCall.name
    const args = (ctx.args ?? {}) as Record<string, unknown>
    const mode = getMode(sessionId)

    // 宿主控制工具不产生工作区副作用，不能被权限模式反向拦截。
    if (isControlTool(toolName)) return undefined

    // ── bypass：全放行 ────────────────────────────────────────
    if (mode === 'bypass') return undefined

    // ── plan：只读 + .md 写入放行，其余拒绝 ────────────────────
    if (mode === 'plan') {
      if (READONLY_TOOLS.has(toolName)) return undefined
      if (toolName.startsWith('mcp__')) return undefined
      if ((toolName === 'write' || toolName === 'edit') && extractPath(args)?.endsWith('.md')) {
        return undefined
      }
      if (toolName === 'bash' && isReadOnlyCommand(String(args.command ?? ''))) return undefined
      return { block: true, reason: '计划模式下不允许执行写操作，请先提交计划等待批准' }
    }

    // ── auto ──────────────────────────────────────────────────
    if (READONLY_TOOLS.has(toolName)) return undefined

    const neverPersist = isNeverPersist(toolName, args)

    // 命中已有规则就放行（但破坏性命令永远不走这条路）
    if (!neverPersist) {
      const hit = loadRules().find((r) => matchRule(r, toolName, args))
      if (hit) {
        hit.hits++
        saveRules()
        return undefined
      }
    }

    // ── 挂起，等用户 ──────────────────────────────────────────
    const request: PermissionRequest = {
      requestId: PendingRequests.newId(),
      sessionId,
      // ★ UI 靠这个把授权请求和对应的工具卡片对上（四态里的「等待授权」）
      toolCallId: ctx.toolCall.id,
      toolName,
      args,
      ...(extractPath(args) ? { affectedPaths: [extractPath(args)!] } : {}),
      risk: assessRisk(toolName, args),
      neverPersist,
      suggestedGrants: neverPersist ? [] : suggestGrants(toolName, args),
    }

    return pending.suspend(request, send, signal)
  }
}

// ── 响应 ──────────────────────────────────────────────────────────

export function respond(res: PermissionResponse): void {
  const request = pending.respond(
    res.requestId,
    res.allowed ? undefined : { block: true, reason: res.reason ?? '用户拒绝了该操作' },
  )
  if (!request) return // 重复响应，忽略

  if (res.allowed && res.grant) {
    addRule({
      tool: request.toolName,
      match: res.grant.match,
      pattern: res.grant.pattern,
      scope: res.grant.scope,
      neverPersist: request.neverPersist,
      ownerId: res.grant.scope === 'session' ? request.sessionId : undefined,
    })
  }
}

export function clearSession(sessionId: string): void {
  pending.clearSession(sessionId)
}

export function getPending(): PermissionRequest[] {
  return pending.list()
}
