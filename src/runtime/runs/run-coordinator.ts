import type {
  AgentEvent,
  StreamFrame,
} from '../../shared/contracts/events.ts'
import type { StartRunInput } from '../../shared/contracts/run.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type {
  AgentEngine,
  AgentInvocation,
} from './agent-engine.ts'
import type { ContextService } from '../context/context-service.ts'
import {
  RunRegistry,
  type ActiveRun,
} from './run-registry.ts'
import type { RunRepository } from './run-repository.ts'
import {
  buildCapabilitySnapshot,
  EMPTY_USAGE_LEDGER,
  mergeUsageLedger,
  type RunUsageLedger,
} from './run-snapshot.ts'

export interface CreateRunCoordinatorOptions {
  now(): number
  engine: AgentEngine
  createInvocation(input: StartRunInput): Promise<AgentInvocation>
  lifecycle: RunSessionLifecycle
  context?: Pick<
    ContextService,
    'observeTurn' | 'beforeModelCall' | 'runSettled'
  >
  /** C12：Run 记录持久化（能力快照 + token 账本），缺省不落盘 */
  runs?: RunRepository
  createRunId?(): string
}

export interface RunSettlement {
  sessionId: string
  status: 'idle' | 'done' | 'failed' | 'interrupted'
  detail?: string
}

export interface RunSessionLifecycle {
  started(sessionId: string): Promise<SessionMeta>
  settled(settlement: RunSettlement): Promise<SessionMeta>
}

export interface RunCoordinator {
  start(input: StartRunInput, emit: (frame: StreamFrame) => void): Promise<void>
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
  /** C12：会话的 Run 账本（能力快照 + token/cost） */
  list(sessionId: string): ReturnType<RunRepository['listBySession']>
  dispose(): Promise<void>
}

class DefaultRunCoordinator implements RunCoordinator {
  readonly #registry: RunRegistry
  readonly #engine: AgentEngine
  readonly #createInvocation: (
    input: StartRunInput,
  ) => Promise<AgentInvocation>
  readonly #lifecycle: RunSessionLifecycle
  readonly #context: CreateRunCoordinatorOptions['context']
  readonly #runs: CreateRunCoordinatorOptions['runs']
  readonly #createRunId: (() => string) | undefined
  readonly #now: () => number
  readonly #inFlight = new Set<Promise<void>>()
  #disposePromise: Promise<void> | undefined

  constructor(options: CreateRunCoordinatorOptions) {
    this.#registry = new RunRegistry({ now: options.now })
    this.#engine = options.engine
    this.#createInvocation = options.createInvocation
    this.#lifecycle = options.lifecycle
    this.#context = options.context
    this.#runs = options.runs
    this.#createRunId = options.createRunId
    this.#now = options.now
  }

  start(
    input: StartRunInput,
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
    this.#registry.cancel(sessionId)
  }

  isRunning(sessionId: string): boolean {
    return this.#registry.isRunning(sessionId)
  }

  list(sessionId: string): ReturnType<RunRepository['listBySession']> {
    return this.#runs?.listBySession(sessionId) ?? []
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#registry.dispose()
    this.#disposePromise = this.#dispose()
    return this.#disposePromise
  }

  async #execute(
    input: StartRunInput,
    run: ActiveRun,
    emit: (frame: StreamFrame) => void,
  ): Promise<void> {
    let terminalEvent:
      | Extract<AgentEvent, { type: 'run_end' }>
      | undefined
    let failureMessage: string | undefined
    let agentErrorVisible = false
    let settlementFailure: string | undefined
    let runRecordId: string | undefined
    let ledger: RunUsageLedger = { ...EMPTY_USAGE_LEDGER }

    try {
      const runningSession = await this.#lifecycle.started(run.sessionId)
      if (run.signal.aborted) {
        terminalEvent = { type: 'run_end', stopReason: 'aborted' }
        return
      }
      this.#emitHostEvent(
        run,
        { type: 'session_updated', session: runningSession },
        emit,
      )
      const sourceInvocation = await this.#createInvocation(input)
      const invocation: AgentInvocation = this.#context
        ? {
            ...sourceInvocation,
            beforeModelCall: (contextTokens, contextWindow) =>
              this.#context!.beforeModelCall({
                sessionId: run.sessionId,
                contextTokens,
                contextWindow,
                emit,
              }),
          }
        : sourceInvocation
      if (this.#runs && this.#createRunId) {
        runRecordId = this.#createRunId()
        this.#runs.create({
          id: runRecordId,
          sessionId: run.sessionId,
          createdAt: this.#now(),
          status: 'running',
          snapshot: {
            ...buildCapabilitySnapshot(invocation),
            usage: { ...EMPTY_USAGE_LEDGER },
          },
        })
      }
      if (run.signal.aborted) {
        terminalEvent = { type: 'run_end', stopReason: 'aborted' }
        return
      }
      for await (const event of this.#engine.run(invocation, run.signal)) {
        if (run.signal.aborted) continue
        if (event.type === 'error') {
          agentErrorVisible = true
          failureMessage ??= event.message
        }
        if (event.type === 'run_end') {
          terminalEvent ??= event
          continue
        }
        if (event.type === 'turn_end' && event.usage) {
          ledger = mergeUsageLedger(ledger, event.usage)
          this.#context?.observeTurn({
            sessionId: run.sessionId,
            usage: event.usage,
            contextWindow: invocationContextWindow(invocation),
            emit,
            isRunning: () => this.#registry.isRunning(run.sessionId),
          })
        }
        this.#emitAgentEvent(run, event, emit)
      }
      if (run.signal.aborted) {
        terminalEvent = { type: 'run_end', stopReason: 'aborted' }
      } else if (!terminalEvent) {
        throw new Error('AgentEngine 未产生 run_end')
      }
      if (
        terminalEvent.stopReason === 'error'
        || terminalEvent.stopReason === 'aborted'
      ) {
        failureMessage ??= terminalEvent.stopReason === 'aborted'
          ? '运行已中止'
          : '模型调用失败'
      }
    } catch (error) {
      if (run.signal.aborted) {
        failureMessage = undefined
        terminalEvent = { type: 'run_end', stopReason: 'aborted' }
      } else {
        failureMessage ??= errorMessage(error)
      }
    } finally {
      const settledStatus = run.signal.aborted
        ? 'interrupted'
        : failureMessage
          ? 'failed'
          : 'done'
      try {
        const settledSession = await this.#lifecycle.settled({
          sessionId: run.sessionId,
          status: settledStatus,
          ...(
            run.signal.aborted
              ? { detail: '用户已停止' }
              : failureMessage
                ? { detail: failureMessage }
                : {}
          ),
        })
        this.#emitHostEvent(
          run,
          { type: 'session_updated', session: settledSession },
          emit,
        )
      } catch (error) {
        settlementFailure = errorMessage(error)
      }

      this.#emitHostEvent(
        run,
        { type: 'pending_requests_cleared' },
        emit,
      )
      const visibleFailure = settlementFailure
        ?? (
          !run.signal.aborted && !agentErrorVisible
            ? failureMessage
            : undefined
        )
      if (visibleFailure) {
        this.#emitHostEvent(
          run,
          {
            type: 'host_error',
            message: visibleFailure,
            recoverable: false,
          },
          emit,
        )
      }
      this.#registry.settle(run)
      if (terminalEvent) this.#emitAgentEvent(run, terminalEvent, emit)
      this.#context?.runSettled(run.sessionId)
      if (runRecordId && this.#runs) {
        const record = this.#runs.get(runRecordId)
        if (record) {
          this.#runs.update({
            ...record,
            settledAt: this.#now(),
            status: settledStatus,
            ...(failureMessage ? { error: failureMessage } : {}),
            snapshot: record.snapshot
              ? { ...record.snapshot, usage: ledger }
              : record.snapshot,
          })
        }
      }
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

  #emitHostEvent(
    run: ActiveRun,
    event: Extract<StreamFrame['payload'], { channel: 'host' }>['event'],
    emit: (frame: StreamFrame) => void,
  ): void {
    emit({
      sessionId: run.sessionId,
      runId: run.runId,
      payload: { channel: 'host', event },
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function invocationContextWindow(invocation: AgentInvocation): number {
  return invocation.channel.models.find((model) => model.id === invocation.modelId)
    ?.contextWindow ?? 0
}
