import type { StreamFrame } from '../../shared/contracts/events.ts'
import type { SendInput } from '../../shared/contracts/ipc.ts'
import {
  RunRegistry,
  type ActiveRun,
} from './run-registry.ts'

export interface RunExecutionContext {
  sessionId: string
  runId: number
  emit(frame: StreamFrame): void
  isRunning(): boolean
}

export interface RunExecutor {
  execute(
    input: SendInput,
    context: RunExecutionContext,
  ): Promise<void>
  stop(sessionId: string): void
}

export interface CreateRunCoordinatorOptions {
  now(): number
  executor: RunExecutor
}

export interface RunCoordinator {
  send(input: SendInput, emit: (frame: StreamFrame) => void): Promise<void>
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
  dispose(): Promise<void>
}

class DefaultRunCoordinator implements RunCoordinator {
  readonly #registry: RunRegistry
  readonly #executor: RunExecutor
  readonly #inFlight = new Set<Promise<void>>()
  #disposePromise: Promise<void> | undefined

  constructor(options: CreateRunCoordinatorOptions) {
    this.#registry = new RunRegistry({ now: options.now })
    this.#executor = options.executor
  }

  send(
    input: SendInput,
    emit: (frame: StreamFrame) => void,
  ): Promise<void> {
    const run = this.#registry.start(input.sessionId)
    if (!run) {
      emit({
        sessionId: input.sessionId,
        runId: 0,
        payload: {
          channel: 'host',
          event: {
            type: 'host_error',
            message: '上一条消息仍在处理中，请稍候',
            recoverable: true,
          },
        },
      })
      return Promise.resolve()
    }

    const operation = this.#execute(input, run, emit)
    this.#inFlight.add(operation)
    const forget = (): void => {
      this.#inFlight.delete(operation)
    }
    void operation.then(forget, forget)
    return operation
  }

  stop(sessionId: string): void {
    if (this.#registry.isRunning(sessionId)) {
      this.#executor.stop(sessionId)
    }
  }

  isRunning(sessionId: string): boolean {
    return this.#registry.isRunning(sessionId)
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    const active = this.#registry.dispose()
    for (const run of active) this.#executor.stop(run.sessionId)
    this.#disposePromise = this.#waitForInFlight()
    return this.#disposePromise
  }

  async #execute(
    input: SendInput,
    run: ActiveRun,
    emit: (frame: StreamFrame) => void,
  ): Promise<void> {
    try {
      await this.#executor.execute(input, {
        sessionId: run.sessionId,
        runId: run.runId,
        emit,
        isRunning: () => this.#registry.isRunning(run.sessionId),
      })
    } finally {
      this.#registry.settle(run)
    }
  }

  async #waitForInFlight(): Promise<void> {
    await Promise.allSettled([...this.#inFlight])
  }
}

export function createRunCoordinator(
  options: CreateRunCoordinatorOptions,
): RunCoordinator {
  return new DefaultRunCoordinator(options)
}
