import type { DelegationRepository } from '../delegation/delegation-repository.ts'
import type { RunAuthorizationGate } from '../ports/run-authorization-gate.ts'

export interface RootRunBudget {
  turns: number
  tokens: number
}

interface RootState {
  controller: AbortController
  budget: RootRunBudget
  taskIds: Set<string>
  stopped: boolean
}

export interface RootRunSupervisor {
  startRoot(rootRunId: string): AbortSignal
  startChild(rootRunId: string, taskId: string): AbortSignal
  consume(rootRunId: string, usage: RootRunBudget): void
  stopTask(rootRunId: string, taskId: string): Promise<void>
  stopRoot(rootRunId: string): Promise<void>
  recover(): number
}

export interface CreateRootRunSupervisorOptions {
  tasks: DelegationRepository
  authorizationGate: RunAuthorizationGate
  maxTurns?: number
  maxTokens?: number
  now(): number
}

export class RootRunBudgetError extends Error {
  readonly code = 'budget_exceeded'
}

/** RootRun 的取消树、预算与重启恢复统一 owner。 */
export function createRootRunSupervisor(options: CreateRootRunSupervisorOptions): RootRunSupervisor {
  const roots = new Map<string, RootState>()
  const maxTurns = options.maxTurns ?? 60
  const maxTokens = options.maxTokens ?? 2_000_000

  const requireRoot = (rootRunId: string): RootState => {
    const existing = roots.get(rootRunId)
    if (existing) return existing
    const created: RootState = {
      controller: new AbortController(),
      budget: { turns: 0, tokens: 0 },
      taskIds: new Set(),
      stopped: false,
    }
    roots.set(rootRunId, created)
    return created
  }

  return {
    startRoot(rootRunId) {
      return requireRoot(rootRunId).controller.signal
    },
    startChild(rootRunId, taskId) {
      const root = requireRoot(rootRunId)
      root.taskIds.add(taskId)
      return root.controller.signal
    },
    consume(rootRunId, usage) {
      const root = requireRoot(rootRunId)
      root.budget.turns += usage.turns
      root.budget.tokens += usage.tokens
      if (root.budget.turns >= maxTurns || root.budget.tokens >= maxTokens) {
        root.controller.abort(new RootRunBudgetError('RootRun 预算已用完'))
        throw new RootRunBudgetError('RootRun 预算已用完')
      }
    },
    async stopTask(rootRunId, taskId) {
      const task = options.tasks.get(taskId)
      if (task && ['queued', 'starting', 'running', 'stopping'].includes(task.status)) {
        const stopping = options.tasks.compareAndSet(task.id, task.version, {
          status: 'stopping',
          updatedAt: options.now(),
        })
        options.tasks.compareAndSet(stopping.id, stopping.version, {
          status: 'stopped',
          stopReason: '用户停止',
          updatedAt: options.now(),
        })
      }
      requireRoot(rootRunId).taskIds.delete(taskId)
    },
    async stopRoot(rootRunId) {
      const root = requireRoot(rootRunId)
      if (root.stopped) return
      root.stopped = true
      root.controller.abort(new DOMException('RootRun 已停止', 'AbortError'))
      await options.authorizationGate.revokeRoot(rootRunId, 'stop')
      for (const taskId of [...root.taskIds]) await this.stopTask(rootRunId, taskId)
    },
    recover() {
      let recovered = 0
      for (const task of options.tasks.listActive()) {
        options.tasks.compareAndSet(task.id, task.version, {
          status: 'interrupted',
          errorCode: 'app_restarted',
          updatedAt: options.now(),
        })
        recovered += 1
      }
      return recovered
    },
  }
}
