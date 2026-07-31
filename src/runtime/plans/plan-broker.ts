import type {
  PlanApproval,
  PlanRequest,
  PlanResponse,
} from '../../shared/contracts/permission.ts'
import { PendingRequests } from '../pending/pending-requests.ts'

/**
 * 计划审批 broker —— 与权限询问共用同一 pending registry 机制。
 *
 * S09 从 Main `plan-service` 迁入：exit_plan_mode 提交的计划在这里挂起，
 * 用户批准/拒绝/停止/会话结束都会 settle 对应 Promise；
 * `pending()` 让渲染进程重载后能把挂起的审批捞回来。
 */
export interface PlanAskBroker {
  requestApproval(
    input: { sessionId: string; plan: string },
    signal?: AbortSignal,
  ): Promise<PlanApproval>
  /**
   * 用户响应。返回是否找到并兑现了请求 —— 重复响应/已消失的请求返回 false。
   */
  respond(response: PlanResponse): boolean
  pending(): PlanRequest[]
  clearSession(sessionId: string): void
}

export interface CreatePlanAskBrokerOptions {
  createId(): string
  /** 登记后再推送；推送失败必须让调用方可见，不能留下悬挂记录 */
  emitRequest(request: PlanRequest): void
}

export function createPlanAskBroker(
  options: CreatePlanAskBrokerOptions,
): PlanAskBroker {
  const pending = new PendingRequests<PlanRequest, PlanApproval>(
    () => ({ approved: false, reason: '操作已中止' }),
    () => ({ approved: false, reason: '会话已结束' }),
  )

  return {
    requestApproval(input, signal) {
      return pending.suspend(
        {
          requestId: options.createId(),
          sessionId: input.sessionId,
          plan: input.plan,
        },
        options.emitRequest,
        signal,
      )
    },
    respond(response) {
      const settled = pending.respond(response.requestId, {
        approved: response.approved,
        ...(response.reason ? { reason: response.reason } : {}),
      })
      return settled !== undefined
    },
    pending: () => pending.list(),
    clearSession: (sessionId) => pending.clearSession(sessionId),
  }
}
