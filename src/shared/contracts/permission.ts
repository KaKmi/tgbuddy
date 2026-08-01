/**
 * 权限公共契约。
 *
 * 设计来自交互原型（docs/06-设计决策.md 决定 3）：
 * **组合粒度 = 工具 × 匹配范围 × 有效期。**
 *
 * 单一粒度必错——按工具太粗（一次点击等于交出 shell），
 * 按参数太细（每个新文件都要重问）。
 */

/** 权限模式。pi 不带任何权限系统，这一层完全是我们自建的 */
export type PermissionMode = 'plan' | 'auto' | 'bypass'

/** 匹配范围随工具类别变 */
export type RuleMatch =
  /** 整个工具放行，如 `web_search` */
  | 'tool'
  /** 路径 glob，给文件类工具，如 `~/project/**` */
  | 'path'
  /** 命令前缀，给命令类工具，如 `git status` */
  | 'prefix'
  /** 连接器的「服务.方法」，如 `postgres-read.select` */
  | 'method'

/** 有效期。默认 project —— 换工作区自动失效 */
export type RuleScope = 'agent_run' | 'delegation' | 'session' | 'project' | 'global'

export interface PermissionRule {
  /** 规则唯一标识；SQLite/内存仓库都以此删除 */
  id: string
  tool: string
  match: RuleMatch
  pattern: string
  /**
   * 命中后的动作。缺省按 allow（「总是允许」）；C06 的「禁止」档
   * 用 deny 持久化。破坏性命令即使 deny 也走询问，见 neverPersist。
   */
  action?: 'allow' | 'deny'
  scope: RuleScope
  /**
   * 破坏性操作命中即 true，**永不可持久化**。
   * 这类操作的价值恰恰在于每次都停一下。
   */
  neverPersist: boolean
  /** 归属：scope 为 session/project 时用于失效判断 */
  ownerId?: string
  /** 规则来源，设置页展示用：用户授权卡创建为 user，系统策略为 system */
  source?: 'user' | 'system'
  /** 创建原因，如「授权卡“总是允许”」 */
  reason?: string
  createdAt: number
  /** 命中次数，设置页展示用 */
  hits: number
}

/** 危险等级。决定 UI 用 inline 卡片还是升级为模态 */
export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * Tool 没有成功时的结构化原因。
 *
 * 该字段只解释已经发生的结果，不能由 Renderer 根据错误文本反向推导权限决策。
 */
export type ToolNonSuccessReason =
  | { kind: 'plan_gate'; code: 'plan_required' | 'plan_revision_required' }
  | { kind: 'permission'; code: 'denied' | 'forbidden' | 'approval_cancelled' }
  | { kind: 'invalid_invocation'; code: string; repairHint?: string }
  | { kind: 'execution'; code: string; retryable: boolean }

export interface PermissionRequest {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  /** 会影响的文件路径，确认框里展示 */
  affectedPaths?: string[]
  risk: RiskLevel
  /**
   * 高危 + 不可逆才升级为模态（docs/06 决定 3）。
   * 当前高危来源只有两类：bash 破坏性命令（neverPersist）与 delete 工具。
   */
  requiresModal: boolean
  /**
   * 为 true 时不显示「总是允许」——破坏性命令只能一次一次批。
   * UI 据此隐藏那个选项，而不是让用户点了才发现没保存。
   */
  neverPersist: boolean
  /** 给 UI 的候选粒度，用户选一个 */
  suggestedGrants: Array<{ match: RuleMatch; pattern: string; label: string }>
}

export interface PermissionResponse {
  requestId: string
  allowed: boolean
  /** 勾了「总是允许」时带上，主进程据此建规则 */
  grant?: { match: RuleMatch; pattern: string; scope: RuleScope }
  /** 拒绝时给模型的理由，让它换个方式做 */
  reason?: string
}

/**
 * 破坏性命令黑名单 —— 命中即 `neverPersist`。
 *
 * 来自交互原型。注意这不是「禁止执行」，是「禁止免检」：
 * 仍然可以执行，但每次都要单独批准。
 */
export const NEVER_PERSIST_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  />\s*\//, // 重定向到根路径
  /\|\s*(sh|bash|zsh)\b/, // curl … | sh
  /git\s+push\s+.*--force/,
  /\bmkfs\b|\bdd\s+if=/,
]

/**
 * 系统级工具黑名单 —— 这些能绕过任何路径白名单，默认禁用。
 * 对应参考产品「安全中心」里那条「WSL、wmic、sc、reg、schtasks…」。
 */
export const SYSTEM_TOOL_PATTERNS: RegExp[] = [
  /^\s*(wsl|wmic|sc|reg|schtasks|net|bcdedit|vssadmin)\b/i,
]

/**
 * 只读命令白名单。
 *
 * ⚠️ **必须排除解释器**，否则 `python -c "os.remove(...)"` 直接绕过。
 * 必须排除解释器，否则任意代码执行可以绕过只读判定。
 */
const READONLY_COMMANDS =
  /^\s*(ls|dir|cat|type|head|tail|wc|find|grep|rg|fd|git\s+(status|log|diff|show|branch)|pwd|echo|which|where|stat|du|df)\b/i
const INTERPRETERS = /\b(node|python[23]?|ruby|perl|php|deno|bun)\s+[^-]/
/**
 * find 的破坏性子命令：-delete / -exec / -execdir / -ok / -okdir 都是写操作，
 * 即使命令里没有管道或重定向，也不能按只读放行（plan 模式会因此绕过审批）。
 */
const FIND_DESTRUCTIVE =
  /(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/i

export function isReadOnlyCommand(command: string): boolean {
  if (INTERPRETERS.test(command)) return false
  if (SYSTEM_TOOL_PATTERNS.some((re) => re.test(command))) return false
  // 有管道/重定向/命令串联就不算只读
  if (/[|>;&]|\$\(|`/.test(command)) return false
  if (FIND_DESTRUCTIVE.test(command)) return false
  return READONLY_COMMANDS.test(command)
}

export function isNeverPersist(toolName: string, args: Record<string, unknown>): boolean {
  // delete 是「无回收站」的破坏性删除，和 rm 同级，永远不能免检
  if (toolName === 'delete') return true
  if (toolName !== 'bash') return false
  const command = typeof args.command === 'string' ? args.command : ''
  return NEVER_PERSIST_PATTERNS.some((re) => re.test(command))
}

// ── 计划审批 ──────────────────────────────────────────────────────

export interface PlanRequest {
  requestId: string
  sessionId: string
  /** 计划正文，markdown */
  plan: string
}

export interface PlanApproval {
  approved: boolean
  reason?: string
}

export interface PlanResponse {
  requestId: string
  approved: boolean
  /** 拒绝时给模型的修改意见 */
  reason?: string
}

// ── 用户问答 ──────────────────────────────────────────────────────

export interface AskUserOption {
  label: string
  description: string
}

export interface AskUserQuestion {
  id: string
  header: string
  question: string
  options: AskUserOption[]
}

export interface AskUserRequest {
  requestId: string
  sessionId: string
  questions: AskUserQuestion[]
}

export interface AskUserAnswer {
  questionId: string
  value: string
}

export interface AskUserResponse {
  requestId: string
  answers: AskUserAnswer[]
}
