import type { RunCoordinator } from '../index.ts'
import type { RunRepository } from '../index.ts'
import type { SessionCommands } from '../index.ts'
import { canDelegate } from './delegation-policy.ts'
import type { StreamFrame } from '../../shared/contracts/events.ts'

export interface DelegationService {
  /**
   * 同步委派：策略校验 → 建 child 会话 → 启动 child run → 收集 settled 摘要。
   * 返回给父 Agent 的文本（成功为摘要，失败为可操作原因）。
   */
  delegate(input: {
    parentSessionId: string
    workspaceId: string
    task: string
    parentToolCallId: string
    signal?: AbortSignal
  }): Promise<{ ok: boolean; text: string }>
  /** D03：父会话停止时级联停止其全部 child run。 */
  stopCascade(parentSessionId: string): void
}

export interface CreateDelegationServiceOptions {
  sessions: SessionCommands
  coordinator: RunCoordinator
  runs?: RunRepository
  createId(): string
  now(): number
}

export function createDelegationService(
  options: CreateDelegationServiceOptions,
): DelegationService {
  // rootRunId → 已创建 child 会话列表（进程内计数；重启后运行中的 child 本来就中止）
  const childrenByRoot = new Map<string, string[]>()
  // 父会话 → rootRunId（停止父会话时找 child）
  const rootByParentSession = new Map<string, string>()

  return {
    async delegate(input) {
      // 父 run 的 lineage：找当前 running 的 run 记录，取其 rootRunId
      const running = options.runs
        ?.listBySession(input.parentSessionId)
        .find((record) => record.status === 'running')
      const rootRunId = running?.rootRunId ?? running?.id ?? input.parentToolCallId
      rootByParentSession.set(input.parentSessionId, rootRunId)
      const children = childrenByRoot.get(rootRunId) ?? []
      const decision = canDelegate({
        childCount: children.length,
        usedTokens: 0,
      })
      if (!decision.ok) {
        return { ok: false, text: decision.reason ?? '委派被拒绝' }
      }

      let childSessionId: string
      try {
      const meta = await options.sessions.create({ title: '子任务' })
      childSessionId = meta.id
      } catch (error) {
        return {
          ok: false,
          text: `子智能体会话创建失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
      // D03：child 继承父会话权限模式（策略引擎对 child 也读父模式）
      const parent = options.sessions.list().find(
        (session) => session.id === input.parentSessionId,
      )
      if (parent) {
        try {
          options.sessions.updateMeta(childSessionId, {
            permissionMode: parent.permissionMode ?? 'auto',
            ...(parent.profileId ? { profileId: parent.profileId } : {}),
            ...(parent.channelId ? { channelId: parent.channelId } : {}),
            ...(parent.modelId ? { modelId: parent.modelId } : {}),
          })
        } catch (error) {
          console.error('[Delegation] child 权限模式继承失败：', error)
        }
      }
      childrenByRoot.set(rootRunId, [...children, childSessionId])

      const summary: string[] = []
      const childEmit = (frame: StreamFrame): void => {
        if (frame.payload.channel !== 'agent') return
        const event = frame.payload.event
        if (
          event.type === 'message_end'
          && event.message?.kind === 'kernel'
          && event.message.message.role === 'assistant'
        ) {
          const text = extractAssistantText(event.message.message.content)
          if (text) summary.push(text)
        }
      }
      try {
        await options.coordinator.start(
          {
            sessionId: childSessionId,
            text: input.task,
            lineage: {
              workspaceId: input.workspaceId,
              sessionId: childSessionId,
              rootRunId,
              agentRunId: options.createId(),
              parentToolCallId: input.parentToolCallId,
              parentSessionId: input.parentSessionId,
            },
          },
          childEmit,
        )
      } catch (error) {
        return {
          ok: false,
          text: `子智能体执行失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
      const last = summary.at(-1)
      return last
        ? { ok: true, text: `子智能体结果：\n${last}` }
        : { ok: false, text: '子智能体没有返回结果' }
    },
    stopCascade(parentSessionId) {
      const rootRunId = rootByParentSession.get(parentSessionId)
      if (!rootRunId) return
      for (const childSessionId of childrenByRoot.get(rootRunId) ?? []) {
        options.coordinator.stop(childSessionId)
      }
    },
  }
}

function extractAssistantText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (block): block is { type: string; text?: string } =>
          typeof block === 'object'
          && block !== null
          && (block as { type?: string }).type === 'text',
      )
      .map((block) => block.text ?? '')
      .join('')
    return text || undefined
  }
  return undefined
}
