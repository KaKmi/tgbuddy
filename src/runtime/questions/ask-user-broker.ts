import type {
  AskUserAnswer,
  AskUserQuestion,
  AskUserRequest,
  AskUserResponse,
} from '../../shared/contracts/permission.ts'
import { PendingRequests } from '../pending/pending-requests.ts'
import type { HumanInteractionRegistry } from '../pending/human-interaction-registry.ts'
import type { EventSource } from '../../shared/contracts/interaction.ts'

/**
 * 用户问答 broker —— 与 permission/plan 共用同一 pending registry 机制，
 * 但保持独立 contract（docs/06 决定 3 的 inline question card）。
 *
 * S10 从 Main `ask-user-service` 迁入：ask_user 工具的结构化问题在这里挂起，
 * 用户提交回答/停止/会话结束都会 settle 对应 Promise；
 * `pending()` 让渲染进程重载后能把挂起的问题捞回来。
 */
export interface AskUserBroker {
  requestAnswers(
    input: { sessionId: string; questions: AskUserQuestion[] },
    signal?: AbortSignal,
  ): Promise<AskUserAnswer[]>
  /**
   * 用户提交回答。返回是否找到并兑现了请求 —— 重复响应/已消失的请求返回 false。
   */
  respond(response: AskUserResponse): boolean
  pending(): AskUserRequest[]
  clearSession(sessionId: string): void
}

export interface CreateAskUserBrokerOptions {
  createId(): string
  /** 登记后再推送；推送失败必须让调用方可见，不能留下悬挂记录 */
  emitRequest(request: AskUserRequest): void
  registry?: HumanInteractionRegistry
  resolveSource?(sessionId: string): EventSource
}

export function createAskUserBroker(
  options: CreateAskUserBrokerOptions,
): AskUserBroker {
  const pending = new PendingRequests<AskUserRequest, AskUserAnswer[]>(
    () => [],
    () => [],
  )

  return {
    requestAnswers(input, signal) {
      const request: AskUserRequest = {
          requestId: options.createId(),
          sessionId: input.sessionId,
          questions: input.questions,
      }
      signal?.addEventListener('abort', () => options.registry?.complete(request.requestId), { once: true })
      return pending.suspend(request, (next) => {
        if (!options.registry) return options.emitRequest(next)
        options.registry.register({
          id: request.requestId,
          kind: 'ask_user',
          source: options.resolveSource?.(input.sessionId) ?? fallbackSource(input.sessionId),
          payload: next,
          activate: () => options.emitRequest(next),
        })
      }, signal)
    },
    respond(response) {
      const settled = pending.respond(response.requestId, response.answers) !== undefined
      if (settled) options.registry?.complete(response.requestId)
      return settled
    },
    pending: () => pending.list(),
    clearSession: (sessionId) => {
      pending.clearSession(sessionId)
      options.registry?.cancelBySession(sessionId)
    },
  }
}

function fallbackSource(sessionId: string): EventSource {
  return { rootRunId: sessionId, runId: sessionId, sessionId, subjectId: sessionId }
}
