import type {
  DelegationTask,
  DelegationTaskUsage,
} from '../../shared/contracts/delegation.ts'

export class DelegationVersionConflictError extends Error {
  readonly code = 'delegation_version_conflict'

  constructor(taskId: string) {
    super(`子任务版本冲突：${taskId}`)
  }
}

export interface DelegationRepository {
  create(task: DelegationTask): DelegationTask
  get(taskId: string): DelegationTask | undefined
  listByRoot(rootRunId: string): DelegationTask[]
  listActive(): DelegationTask[]
  compareAndSet(
    taskId: string,
    expectedVersion: number,
    patch: Partial<Omit<DelegationTask, 'id' | 'rootRunId' | 'version'>>,
  ): DelegationTask
  appendUsage(taskId: string, expectedVersion: number, usage: Partial<DelegationTaskUsage>): DelegationTask
}

export class MemoryDelegationRepository implements DelegationRepository {
  readonly #tasks = new Map<string, DelegationTask>()

  create(task: DelegationTask): DelegationTask {
    this.#tasks.set(task.id, structuredClone(task))
    return this.#require(task.id)
  }

  get(taskId: string): DelegationTask | undefined {
    const task = this.#tasks.get(taskId)
    return task ? structuredClone(task) : undefined
  }

  listByRoot(rootRunId: string): DelegationTask[] {
    return [...this.#tasks.values()]
      .filter((task) => task.rootRunId === rootRunId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((task) => structuredClone(task))
  }

  listActive(): DelegationTask[] {
    return [...this.#tasks.values()]
      .filter((task) => ['queued', 'starting', 'running', 'stopping'].includes(task.status))
      .map((task) => structuredClone(task))
  }

  compareAndSet(taskId: string, expectedVersion: number, patch: Partial<DelegationTask>): DelegationTask {
    const current = this.#require(taskId)
    if (current.version !== expectedVersion) throw new DelegationVersionConflictError(taskId)
    this.#tasks.set(taskId, { ...current, ...patch, id: current.id, rootRunId: current.rootRunId, version: current.version + 1 })
    return this.#require(taskId)
  }

  appendUsage(taskId: string, expectedVersion: number, usage: Partial<DelegationTaskUsage>): DelegationTask {
    const current = this.#require(taskId)
    return this.compareAndSet(taskId, expectedVersion, {
      usage: {
        turns: current.usage.turns + (usage.turns ?? 0),
        inputTokens: current.usage.inputTokens + (usage.inputTokens ?? 0),
        outputTokens: current.usage.outputTokens + (usage.outputTokens ?? 0),
        costUsd: current.usage.costUsd + (usage.costUsd ?? 0),
      },
    })
  }

  #require(taskId: string): DelegationTask {
    const task = this.#tasks.get(taskId)
    if (!task) throw new Error(`子任务不存在：${taskId}`)
    return structuredClone(task)
  }
}
