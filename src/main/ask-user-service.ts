/** 用户问答服务 —— 挂起 Agent，等待用户补充必要信息。 */

import { PendingRequests } from './pending-request.ts'
import type {
  AskUserAnswer,
  AskUserRequest,
  AskUserResponse,
} from '../shared/types/permission.ts'

const pending = new PendingRequests<AskUserRequest, AskUserAnswer[]>(() => [], () => [])

export type AskUserSender = (request: AskUserRequest) => void

export function requestAnswers(
  sessionId: string,
  questions: AskUserRequest['questions'],
  send: AskUserSender,
  signal?: AbortSignal,
): Promise<AskUserAnswer[]> {
  return pending.suspend(
    { requestId: PendingRequests.newId(), sessionId, questions },
    send,
    signal,
  )
}

export function respond(res: AskUserResponse): void {
  pending.respond(res.requestId, res.answers)
}

export function clearSession(sessionId: string): void {
  pending.clearSession(sessionId)
}

export function getPending(): AskUserRequest[] {
  return pending.list()
}
