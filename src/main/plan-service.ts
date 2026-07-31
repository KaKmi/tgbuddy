/**
 * 计划审批 —— 复用和权限确认同一套挂起机制。
 *
 * 这是 `PendingRequests` 的第二个使用方。三个逃生口（abort / 会话结束 /
 * 重载恢复）全部由它保证，这里只关心业务字段。
 */

import { randomUUID } from 'node:crypto'
import { PendingRequests } from '../runtime/index.ts'
import type { PlanApproval, PlanRequest, PlanResponse } from '../shared/types/permission.ts'

const pending = new PendingRequests<PlanRequest, PlanApproval>(
  () => ({ approved: false, reason: '操作已中止' }),
  () => ({ approved: false, reason: '会话已结束' }),
)

export type PlanSender = (request: PlanRequest) => void

export function requestApproval(
  sessionId: string,
  plan: string,
  send: PlanSender,
  signal?: AbortSignal,
): Promise<PlanApproval> {
  return pending.suspend({ requestId: randomUUID(), sessionId, plan }, send, signal)
}

export function respond(res: PlanResponse): void {
  pending.respond(res.requestId, {
    approved: res.approved,
    ...(res.reason ? { reason: res.reason } : {}),
  })
}

export function clearSession(sessionId: string): void {
  pending.clearSession(sessionId)
}

export function getPending(): PlanRequest[] {
  return pending.list()
}
