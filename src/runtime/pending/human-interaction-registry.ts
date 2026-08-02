import type {
  DelegationAttention,
  EventSource,
  HumanInteractionKind,
  HumanInteractionRequest,
} from '../../shared/contracts/interaction.ts'

interface RegistryEntry {
  id: string
  kind: HumanInteractionKind
  source: EventSource
  activate(): void
}

export class HumanInteractionRegistryError extends Error {
  readonly code = 'interaction_queue_full'
}

export interface HumanInteractionRegistry {
  register(entry: RegistryEntry): void
  complete(interactionId: string): void
  cancelBySession(sessionId: string): void
  cancelByRoot(rootRunId: string): void
  listPending(rootRunId?: string): HumanInteractionRequest[]
  attention(taskId: string): DelegationAttention | undefined
}

/** 每个 root 最多一个 active，后续交互按登记顺序排队。 */
export function createHumanInteractionRegistry(maxPending = 8): HumanInteractionRegistry {
  const queues = new Map<string, RegistryEntry[]>()

  const activateHead = (rootRunId: string): void => queues.get(rootRunId)?.[0]?.activate()
  const remove = (predicate: (entry: RegistryEntry) => boolean): void => {
    for (const [rootRunId, queue] of queues) {
      const head = queue[0]
      const next = queue.filter((entry) => !predicate(entry))
      if (next.length === 0) queues.delete(rootRunId)
      else queues.set(rootRunId, next)
      if (head && predicate(head) && next.length > 0) activateHead(rootRunId)
    }
  }

  return {
    register(entry) {
      const queue = queues.get(entry.source.rootRunId) ?? []
      if (queue.some((item) => item.id === entry.id)) return
      if (queue.length >= maxPending) throw new HumanInteractionRegistryError('等待用户处理的请求过多')
      queue.push(entry)
      queues.set(entry.source.rootRunId, queue)
      if (queue.length === 1) entry.activate()
    },
    complete(interactionId) {
      remove((entry) => entry.id === interactionId)
    },
    cancelBySession(sessionId) {
      remove((entry) => entry.source.sessionId === sessionId)
    },
    cancelByRoot(rootRunId) {
      queues.delete(rootRunId)
    },
    listPending(rootRunId) {
      const selected = rootRunId ? [[rootRunId, queues.get(rootRunId) ?? []] as const] : [...queues.entries()]
      return selected.flatMap(([, queue]) => queue.map((entry, index) => ({
        id: entry.id,
        kind: entry.kind,
        source: entry.source,
        active: index === 0,
        queuePosition: index,
      })))
    },
    attention(taskId) {
      const item = this.listPending().find((entry) => entry.source.taskId === taskId)
      return item ? {
        kind: item.kind === 'ask_user' ? 'user' : item.kind,
        interactionId: item.id,
        active: item.active,
        queuePosition: item.queuePosition,
      } : undefined
    },
  }
}
