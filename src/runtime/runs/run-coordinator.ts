import type {
  AgentEvent,
  StreamFrame,
} from '../../shared/contracts/events.ts'
import type { SendInput } from '../../shared/contracts/ipc.ts'
import type {
  AgentEngine,
  AgentInvocation,
} from './agent-engine.ts'
import {
  RunRegistry,
  type ActiveRun,
} from './run-registry.ts'

export interface CreateRunCoordinatorOptions {
  now(): number
  engine: AgentEngine
  createInvocation(input: SendInput): Promise<AgentInvocation>
}

export interface RunCoordinator {
  send(input: SendInput, emit: (frame: StreamFrame) => void): Promise<void>
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
  dispose(): Promise<void>
}

class DefaultRunCoordinator implements RunCoordinator {
  readonly #registry: RunRegistry
  readonly #engine: AgentEngine
  readonly #createInvocation: (
    input: SendInput,
  ) => Promise<AgentInvocation>
  readonly #inFlight = new Set<Promise<void>>()
  #disposePromise: Promise<void> | undefined

  constructor(options: CreateRunCoordinatorOptions) {
    this.#registry = new RunRegistry({ now: options.now })
    this.#engine = options.engine
    this.#createInvocation = options.createInvocation
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
      this.#engine.abort(sessionId)
    }
  }

  isRunning(sessionId: string): boolean {
    return this.#registry.isRunning(sessionId)
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    const active = this.#registry.dispose()
    for (const run of active) this.#engine.abort(run.sessionId)
    this.#disposePromise = this.#dispose()
    return this.#disposePromise
  }

  async #execute(
    input: SendInput,
    run: ActiveRun,
    emit: (frame: StreamFrame) => void,
  ): Promise<void> {
    try {
      const invocation = await this.#createInvocation(input)
      for await (const event of this.#engine.run(invocation)) {
        this.#emitAgentEvent(run, event, emit)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit({
        sessionId: run.sessionId,
        runId: run.runId,
        payload: {
          channel: 'host',
          event: {
            type: 'host_error',
            message,
            recoverable: false,
          },
        },
      })
    } finally {
      this.#registry.settle(run)
    }
  }

  #emitAgentEvent(
    run: ActiveRun,
    event: AgentEvent,
    emit: (frame: StreamFrame) => void,
  ): void {
    emit({
      sessionId: run.sessionId,
      runId: run.runId,
      payload: { channel: 'agent', event },
    })
  }

  async #dispose(): Promise<void> {
    await Promise.allSettled([...this.#inFlight])
    await this.#engine.dispose()
  }
}

export function createRunCoordinator(
  options: CreateRunCoordinatorOptions,
): RunCoordinator {
  return new DefaultRunCoordinator(options)
}
