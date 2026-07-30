import type { StreamFrame } from '../../shared/contracts/events.ts'

export type RuntimeEvent = StreamFrame
export type RuntimeEventListener = (event: RuntimeEvent) => void

export interface RuntimeEventPublisher {
  emit(event: RuntimeEvent): void
  subscribe(listener: RuntimeEventListener): () => void
  clear(): void
}

export function createRuntimeEventPublisher(): RuntimeEventPublisher {
  const listeners = new Set<RuntimeEventListener>()

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
