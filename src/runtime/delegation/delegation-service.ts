import type { RunCoordinator } from '../index.ts'
import type { RunRepository } from '../index.ts'
import type { SessionCommands } from '../index.ts'
import { canDelegate } from './delegation-policy.ts'
import type { StreamFrame } from '../../shared/contracts/events.ts'
import type { PermissionCeilingSnapshot } from '../../shared/contracts/run-snapshot.ts'
import {
  MemoryDelegationRepository,
  type DelegationRepository,
} from './delegation-repository.ts'
import type { RootRunSupervisor } from '../runs/root-run-supervisor.ts'

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
    role?: 'explorer' | 'worker'
    delegationIntentId?: string
    parentCeiling?: PermissionCeilingSnapshot
    signal?: AbortSignal
  }): Promise<{ ok: boolean; text: string }>
  /** D03：父会话停止时级联停止其全部 child run。 */
  stopCascade(parentSessionId: string): void
}

export interface CreateDelegationServiceOptions {
  sessions: SessionCommands
  coordinator: RunCoordinator
  runs?: RunRepository
  tasks?: DelegationRepository
  supervisor?: RootRunSupervisor
  createId(): string
  now(): number
}

export function createDelegationService(
  options: CreateDelegationServiceOptions,
): DelegationService {
  const taskRepository = options.tasks ?? new MemoryDelegationRepository()
  // rootRunId → 已创建 child 会话列表（进程内计数；重启后运行中的 child 本来就中止）
  const childrenByRoot = new Map<string, string[]>()
  // 父会话 → rootRunId（停止父会话时找 child）
  const rootByParentSession = new Map<string, string>()
  const activeRoots = new Set<string>()

  return {
    async delegate(input) {
      // 父 run 的 lineage：找当前 running 的 run 记录，取其 rootRunId
      const running = options.runs
        ?.listBySession(input.parentSessionId)
        .find((record) => record.status === 'running')
      const rootRunId = running?.rootRunId ?? running?.id ?? input.parentToolCallId
      options.supervisor?.startRoot(rootRunId)
      rootByParentSession.set(input.parentSessionId, rootRunId)
      const children = childrenByRoot.get(rootRunId) ?? []
      const durable = taskRepository.listByRoot(rootRunId)
      const decision = canDelegate({
        childCount: durable.length,
        activeCount: durable.filter((task) => ['queued', 'starting', 'running', 'stopping'].includes(task.status)).length,
        depth: running?.parentToolCallId ? 1 : 0,
        usedTokens: 0,
      })
      if (!decision.ok) {
        return { ok: false, text: decision.reason ?? '委派被拒绝' }
      }
      if (activeRoots.has(rootRunId)) {
        return { ok: false, text: '已有子智能体正在执行，请等待完成后再委派' }
      }
      activeRoots.add(rootRunId)

      let childSessionId: string
      try {
      const meta = await options.sessions.create({
        title: '子任务',
        visibility: 'internal',
        parentTaskId: input.parentToolCallId,
      })
      childSessionId = meta.id
      } catch (error) {
        activeRoots.delete(rootRunId)
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
      const now = options.now()
      const taskId = `${rootRunId}:${input.parentToolCallId}`
      const role = input.role ?? 'explorer'
      const childCeiling = deriveChildCeiling(
        input.parentCeiling ?? fallbackCeiling(input.parentSessionId, input.workspaceId),
        role,
      )
      let task = taskRepository.create({
        id: taskId,
        rootRunId,
        rootSessionId: input.parentSessionId,
        childSessionId,
        ...(input.delegationIntentId ? { parentTaskId: input.delegationIntentId } : {}),
        role,
        title: input.task.slice(0, 80),
        task: input.task,
        status: 'queued',
        version: 0,
        usage: { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        permissionCeiling: childCeiling,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      task = taskRepository.compareAndSet(task.id, task.version, {
        status: 'starting',
        updatedAt: options.now(),
      })
      options.supervisor?.startChild(rootRunId, task.id)
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
        task = taskRepository.compareAndSet(task.id, task.version, {
          status: 'running',
          updatedAt: options.now(),
        })
        await options.coordinator.start(
          {
            sessionId: childSessionId,
            text: input.task,
            identity: {
              rootSessionId: input.parentSessionId,
              executionSessionId: childSessionId,
              rootRunId,
              agentRunId: options.createId(),
              delegationId: task.id,
              role,
              parentToolCallId: input.parentToolCallId,
            },
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
        taskRepository.compareAndSet(task.id, task.version, {
          status: 'failed',
          errorCode: error instanceof Error ? error.name : 'unknown',
          updatedAt: options.now(),
        })
        activeRoots.delete(rootRunId)
        return {
          ok: false,
          text: `子智能体执行失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
      const last = summary.at(-1)
      taskRepository.compareAndSet(task.id, task.version, {
        status: last ? 'completed' : 'failed',
        updatedAt: options.now(),
      })
      activeRoots.delete(rootRunId)
      return last
        ? { ok: true, text: `子智能体结果：\n${last}` }
        : { ok: false, text: '子智能体没有返回结果' }
    },
    stopCascade(parentSessionId) {
      const rootRunId = rootByParentSession.get(parentSessionId)
      if (!rootRunId) return
      void options.supervisor?.stopRoot(rootRunId)
      for (const childSessionId of childrenByRoot.get(rootRunId) ?? []) {
        options.coordinator.stop(childSessionId)
      }
    },
  }
}

function deriveChildCeiling(
  parent: PermissionCeilingSnapshot,
  role: 'explorer' | 'worker',
): PermissionCeilingSnapshot {
  const explorerTools = new Set(['read', 'glob', 'grep', 'skill', 'ask_user'])
  return {
    ...parent,
    role,
    maxAutoRisk: role === 'explorer' ? 'R1' : parent.maxAutoRisk,
    allowedToolIds: role === 'explorer'
      ? parent.allowedToolIds.filter((tool) => explorerTools.has(tool))
      : [...parent.allowedToolIds],
  }
}

function fallbackCeiling(rootSessionId: string, workspaceId: string): PermissionCeilingSnapshot {
  return {
    schemaVersion: 1,
    policyVersion: 'permission-v2',
    mode: 'auto',
    rootSessionId,
    workspaceId,
    mountRevision: 'legacy',
    allowedToolIds: ['read', 'glob', 'grep', 'skill', 'ask_user'],
    maxAutoRisk: 'R1',
    role: 'root',
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
