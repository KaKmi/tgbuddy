import {
  isNeverPersist,
  isReadOnlyCommand,
  type PermissionRequest,
  type PermissionResponse,
  type RiskLevel,
} from '../../shared/contracts/permission.ts'
import { PendingRequests } from '../pending/pending-requests.ts'
import type { PermissionAskInput } from './policy-engine.ts'
import {
  InteractionResponseConflictError,
  interactionResponseHash,
  type InteractionDecisionReceipt,
  type InteractionDecisionWriter,
} from '../pending/interaction-decision-writer.ts'
import type { PermissionRule } from '../../shared/contracts/permission.ts'
import type { HumanInteractionRegistry } from '../pending/human-interaction-registry.ts'
import type { EventSource } from '../../shared/contracts/interaction.ts'

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
  ask(input: PermissionAskInput, signal: AbortSignal): Promise<PermissionAskOutcome>
  /**
   * 用户响应。返回是否找到并兑现了请求 —— 重复响应/已消失的请求返回 false。
   */
  respond(response: PermissionResponse): Promise<InteractionDecisionReceipt | undefined>
  pending(): PermissionRequest[]
  clearSession(sessionId: string): void
}

export interface PermissionAskOutcome {
  allowed: boolean
  decisionId?: string
  /** 拒绝时用户给出的理由，模型据此换一种方式（PermissionResponse.reason 透传） */
  reason?: string
}

export interface CreatePermissionAskBrokerOptions {
  createId(): string
  /** 登记后再推送；推送失败必须让调用方可见，不能留下悬挂记录 */
  emitRequest(request: PermissionRequest): void
  /**
   * 用户勾选「总是允许」并允许时的落点。S07 起由 Composition Root 注入，
   * 负责按 scope 解析 ownerId 并写入规则仓库；本类不直接依赖仓库。
   */
  buildRule?(
    request: PermissionRequest,
    grant: NonNullable<PermissionResponse['grant']>,
  ): Omit<PermissionRule, 'createdAt' | 'hits'>
  decisionWriter?: InteractionDecisionWriter
  registry?: HumanInteractionRegistry
  resolveSource?(sessionId: string, toolCallId?: string): EventSource
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
    const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const dir = separatorIndex === -1 ? '' : path.slice(0, separatorIndex)
    if (dir) {
      // 目录级候选：放行 dir/** —— 注意不能覆盖文件本身（见下一条精确候选）
      out.push({
        match: 'path',
        pattern: `${dir}/**`,
        label: `放行 ${dir} 目录下的操作`,
      })
    }
    // 精确文件候选：根目录文件没有父目录时，只有这条能真正命中
    out.push({ match: 'path', pattern: path, label: `放行 ${path}` })
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
  const pending = new PendingRequests<PermissionRequest, PermissionAskOutcome>(
    () => ({ allowed: false, reason: '操作已中止' }),
    () => ({ allowed: false, reason: '会话已结束' }),
  )

  return {
    ask(input, signal) {
      const { sessionId, toolCallId, toolName, args } = input
      const neverPersist = isNeverPersist(toolName, args)
      const path = extractPath(args)
      const risk = assessRisk(toolName, args)
      const request: PermissionRequest = {
        requestId: options.createId(),
        sessionId,
        toolCallId,
        toolName,
        args,
        ...(path ? { affectedPaths: [path] } : {}),
        risk,
        // 高危来源当前只有「不可逆」（破坏性命令 / delete），两者同真
        requiresModal: risk === 'high',
        neverPersist,
        suggestedGrants: neverPersist ? [] : suggestGrants(toolName, args),
      }
      const source = input.subject
        ? {
            rootRunId: input.subject.rootRunId,
            runId: input.subject.agentRunId,
            sessionId: input.sessionId,
            subjectId: input.subject.agentRunId,
            ...(input.subject.delegationId ? { taskId: input.subject.delegationId } : {}),
            toolCallId: input.toolCallId,
          }
        : options.resolveSource?.(input.sessionId, input.toolCallId)
          ?? fallbackSource(input.sessionId, input.toolCallId)
      signal.addEventListener('abort', () => options.registry?.complete(request.requestId), { once: true })
      return pending.suspend(request, (next) => {
        if (!options.registry) return options.emitRequest(next)
        options.registry.register({
          id: request.requestId,
          kind: 'permission',
          source,
          payload: next,
          activate: () => options.emitRequest(next),
        })
      }, signal)
    },
    async respond(response) {
      const request = pending.get(response.requestId)
      const responseHash = interactionResponseHash(response)
      if (!request) {
        const receipt = options.decisionWriter?.findReceipt(response.requestId)
        if (!receipt) return undefined
        if (receipt.responseHash !== responseHash) {
          throw new InteractionResponseConflictError(response.requestId)
        }
        return receipt
      }
      const rule = response.allowed && response.grant && !request.neverPersist
        ? options.buildRule?.(request, response.grant)
        : undefined
      const receipt = options.decisionWriter
        ? await options.decisionWriter.commit({
            kind: 'permission',
            request,
            response,
            responseHash,
            ...(rule ? { rule } : {}),
          })
        : {
            status: 'committed' as const,
            requestId: request.requestId,
            decisionId: `legacy:${request.requestId}`,
            responseHash,
            kind: 'permission' as const,
            executionState: response.allowed ? 'accepted_not_executed' as const : 'completed' as const,
          }
      pending.respond(response.requestId, {
        allowed: response.allowed,
        ...(options.decisionWriter ? { decisionId: receipt.decisionId } : {}),
        ...(response.reason ? { reason: response.reason } : {}),
      })
      options.registry?.complete(response.requestId)
      return receipt
    },
    pending: () => pending.list(),
    clearSession: (sessionId) => {
      pending.clearSession(sessionId)
      options.registry?.cancelBySession(sessionId)
    },
  }
}

function fallbackSource(sessionId: string, toolCallId?: string): EventSource {
  return {
    rootRunId: sessionId,
    runId: sessionId,
    sessionId,
    subjectId: sessionId,
    ...(toolCallId ? { toolCallId } : {}),
  }
}
