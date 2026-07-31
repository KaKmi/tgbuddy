import {
  isNeverPersist,
  isReadOnlyCommand,
  type PermissionRequest,
  type PermissionResponse,
  type RiskLevel,
} from '../../shared/contracts/permission.ts'
import { PendingRequests } from '../pending/pending-requests.ts'
import type { PermissionAskInput } from './policy-engine.ts'

/**
 * 授权询问 broker —— 请求由 Runtime registry 持有，IPC 只按 requestId 响应。
 *
 * S06 从 Main `permission-service` 迁入：ask 决策落到这里挂起，
 * 用户允许/拒绝/停止/会话结束都会 settle 对应 Promise；
 * `pending()` 让渲染进程重载后能把挂起的请求捞回来。
 *
 * S07 接入规则持久化后，broker 不负责建规则 —— 那是
 * `PermissionRuleRepository` 的职责，本类只做“等用户”这件事。
 */
export interface PermissionAskBroker {
  ask(input: PermissionAskInput, signal: AbortSignal): Promise<boolean>
  /**
   * 用户响应。返回是否找到并兑现了请求 —— 重复响应/已消失的请求返回 false。
   */
  respond(response: PermissionResponse): boolean
  pending(): PermissionRequest[]
  clearSession(sessionId: string): void
}

export interface CreatePermissionAskBrokerOptions {
  createId(): string
  /** 登记后再推送；推送失败必须让调用方可见，不能留下悬挂记录 */
  emitRequest(request: PermissionRequest): void
}

const READONLY_TOOLS = new Set(['read', 'glob', 'grep', 'web_search'])

/** 危险等级来自工具类别 + 参数，不来自工具名 —— 规则简单且可解释（docs/06 决定 3） */
export function assessRisk(
  toolName: string,
  args: Record<string, unknown>,
): RiskLevel {
  if (READONLY_TOOLS.has(toolName)) return 'low'
  if (toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    return isNeverPersist('bash', args)
      ? 'high'
      : isReadOnlyCommand(command)
        ? 'low'
        : 'medium'
  }
  if (toolName === 'delete') return 'high'
  return 'medium' // write / edit
}

/** 给 UI 的候选粒度。用户从中选一个，S07 决定规则怎么建 */
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

function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'file_path', 'filePath']) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

export function createPermissionAskBroker(
  options: CreatePermissionAskBrokerOptions,
): PermissionAskBroker {
  const pending = new PendingRequests<PermissionRequest, boolean>(
    () => false,
    () => false,
  )

  return {
    ask(input, signal) {
      const { sessionId, toolCallId, toolName, args } = input
      const neverPersist = isNeverPersist(toolName, args)
      const path = extractPath(args)
      const request: PermissionRequest = {
        requestId: options.createId(),
        sessionId,
        toolCallId,
        toolName,
        args,
        ...(path ? { affectedPaths: [path] } : {}),
        risk: assessRisk(toolName, args),
        neverPersist,
        suggestedGrants: neverPersist ? [] : suggestGrants(toolName, args),
      }
      return pending.suspend(request, options.emitRequest, signal)
    },
    respond(response) {
      return pending.respond(response.requestId, response.allowed) !== undefined
    },
    pending: () => pending.list(),
    clearSession: (sessionId) => pending.clearSession(sessionId),
  }
}
