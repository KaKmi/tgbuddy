import type { StreamFrame } from '../../shared/contracts/events.ts'

export type AgentRuntimeEvent = StreamFrame
export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void

export interface AgentRuntimeEventPublisher {
  emit(event: AgentRuntimeEvent): void
  subscribe(listener: AgentRuntimeEventListener): () => void
  clear(): void
}

export function createAgentRuntimeEventPublisher(): AgentRuntimeEventPublisher {
  const listeners = new Set<AgentRuntimeEventListener>()

  return {
    emit(event) {
      for (const listener of listeners) listener(event)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clear() {
      listeners.clear()
    },
  }
}
