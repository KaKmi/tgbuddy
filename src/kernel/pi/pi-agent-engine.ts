import {
  AgentHarness,
  type AgentHarnessEvent,
  type AgentMessage,
  type Session,
} from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  Message as PiMessage,
  StopReason,
} from '@earendil-works/pi-ai'
import { KERNEL_ID } from '../../shared/contracts/message.ts'
import type {
  AgentEvent,
} from '../../shared/contracts/events.ts'
import type {
  AgentEngine,
  AgentInvocation,
} from '../../runtime/runs/agent-engine.ts'
import { buildModels } from './pi-models.ts'

export interface PiAgentSessionProvider {
  openHarnessSession(
    sessionId: string,
    kernel: string,
  ): Promise<Session | undefined>
}

export interface CreatePiAgentEngineOptions {
  sessions: PiAgentSessionProvider
}

export interface PersistedPiMessage {
  id: string
  createdAt: number
  message: PiMessage
}

interface QueueWaiter<T> {
  resolve(result: IteratorResult<T>): void
}

/**
 * Harness 用订阅回调推事件，Runtime 用 AsyncIterable 拉事件。
 * 这个极小队列只负责桥接背压边界，不缓存到磁盘，也不改变事件顺序。
 */
class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
  readonly #items: T[] = []
  readonly #waiters: Array<QueueWaiter<T>> = []
  #closed = false

  push(item: T): void {
    if (this.#closed) return
    const waiter = this.#waiters.shift()
    if (waiter) {
      waiter.resolve({ value: item, done: false })
      return
    }
    this.#items.push(item)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    while (this.#waiters.length > 0) {
      this.#waiters.shift()?.resolve({
        value: undefined,
        done: true,
      })
    }
  }

  next(): Promise<IteratorResult<T>> {
    const item = this.#items.shift()
    if (item !== undefined) {
      return Promise.resolve({ value: item, done: false })
    }
    if (this.#closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise((resolve) => {
      this.#waiters.push({ resolve })
    })
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this
  }
}

class PiAgentEngine implements AgentEngine {
  readonly #sessions: PiAgentSessionProvider
  readonly #active = new Map<string, AgentHarness>()
  #disposed = false

  constructor(options: CreatePiAgentEngineOptions) {
    this.#sessions = options.sessions
  }

  async *run(
    invocation: AgentInvocation,
  ): AsyncIterable<AgentEvent> {
    if (this.#disposed) throw new Error('PiAgentEngine 已关闭')
    if (this.#active.has(invocation.sessionId)) {
      throw new Error(`Session ${invocation.sessionId} 的 AgentHarness 已在运行`)
    }

    const session = await this.#sessions.openHarnessSession(
      invocation.sessionId,
      KERNEL_ID,
    )
    if (!session) {
      throw new Error(`Session 消息后端不存在：${invocation.sessionId}`)
    }

    const models = buildModels([invocation.channel])
    const model = models.getModel(invocation.channel.id, invocation.modelId)
    if (!model) {
      throw new Error(
        `模型未注册：${invocation.channel.id}/${invocation.modelId}`,
      )
    }

    const harness = new AgentHarness({
      session,
      models,
      model,
      systemPrompt: invocation.systemPrompt,
    })
    const events = new AsyncEventQueue<AgentEvent>()
    let promptSettled = false
    let promptFailed = false
    let promptError: unknown
    let sawErrorEvent = false

    const unsubscribe = harness.subscribe(async (event) => {
      const persisted = event.type === 'message_end'
        ? await persistedMessage(session, event.message)
        : undefined
      const runtimeEvent = piEventToAgentEvent(event, persisted)
      if (runtimeEvent?.type === 'error') sawErrorEvent = true
      if (event.type === 'message_end' && !sawErrorEvent) {
        const failure = piMessageFailureEvent(event.message)
        if (failure) {
          sawErrorEvent = true
          events.push(failure)
        }
      }
      if (runtimeEvent) events.push(runtimeEvent)
    })

    this.#active.set(invocation.sessionId, harness)
    const prompt = harness.prompt(invocation.text)
      .then(() => undefined, (error: unknown) => {
        promptFailed = true
        promptError = error
      })
      .finally(() => {
        promptSettled = true
        events.close()
      })

    try {
      for await (const event of events) yield event
      await prompt
      if (promptFailed) throw promptError
    } finally {
      unsubscribe()
      if (this.#active.get(invocation.sessionId) === harness) {
        this.#active.delete(invocation.sessionId)
      }
      if (!promptSettled) {
        await harness.abort()
        await prompt
      }
    }
  }

  abort(sessionId: string): void {
    const harness = this.#active.get(sessionId)
    if (harness) void harness.abort()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const active = [...this.#active.values()]
    await Promise.allSettled(active.map((harness) => harness.abort()))
    await Promise.allSettled(active.map((harness) => harness.waitForIdle()))
    this.#active.clear()
  }
}

/**
 * pi/Harness 事件到公共 AgentEvent 的唯一适配点。
 */
export function piEventToAgentEvent(
  event: AgentHarnessEvent,
  persisted?: PersistedPiMessage,
): AgentEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'run_start' }

    case 'turn_start':
      return { type: 'turn_start' }

    case 'message_update': {
      const inner = event.assistantMessageEvent
      if (inner.type === 'text_delta') {
        return { type: 'text_delta', delta: inner.delta }
      }
      if (inner.type === 'thinking_delta') {
        return { type: 'thinking_delta', delta: inner.delta }
      }
      if (inner.type === 'error') {
        return {
          type: 'error',
          reason: inner.reason,
          message: inner.error.errorMessage ?? '未知错误',
        }
      }
      return null
    }

    case 'message_end':
      if (!isPiMessage(event.message)) return null
      if (!persisted) throw new Error('message_end 缺少持久化信封')
      return {
        type: 'message_end',
        message: {
          kind: 'kernel',
          id: persisted.id,
          createdAt: persisted.createdAt,
          message: persisted.message,
        },
      }

    case 'tool_execution_start':
      return {
        type: 'tool_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: isRecord(event.args) ? event.args : {},
      }

    case 'tool_execution_update':
      return {
        type: 'tool_progress',
        toolCallId: event.toolCallId,
        partial: event.partialResult,
      }

    case 'tool_execution_end': {
      const details = extractDetails(event.result)
      return {
        type: 'tool_end',
        toolCallId: event.toolCallId,
        isError: event.isError,
        ...(details ? { details } : {}),
      }
    }

    case 'turn_end': {
      const usage = event.message.role === 'assistant'
        ? event.message.usage
        : undefined
      return {
        type: 'turn_end',
        ...(usage ? { usage } : {}),
      }
    }

    case 'agent_end':
      return {
        type: 'run_end',
        stopReason: lastAssistantStopReason(event.messages),
      }

    default:
      return null
  }
}

/**
 * 部分 provider 只在最终 AssistantMessage 上写 stopReason/errorMessage，
 * 不发送 `message_update.error`。这里补齐公共 error 事件，避免认证失败静默。
 */
export function piMessageFailureEvent(
  message: AgentMessage,
): Extract<AgentEvent, { type: 'error' }> | null {
  if (
    message.role !== 'assistant'
    || (
      message.stopReason !== 'error'
      && message.stopReason !== 'aborted'
    )
  ) {
    return null
  }
  return {
    type: 'error',
    reason: message.stopReason,
    message: message.errorMessage ?? (
      message.stopReason === 'aborted' ? '运行已中止' : '未知错误'
    ),
  }
}

async function persistedMessage(
  session: Session,
  expected: AgentMessage,
): Promise<PersistedPiMessage> {
  const leafId = await session.getLeafId()
  const entry = leafId ? await session.getEntry(leafId) : undefined
  if (!entry || entry.type !== 'message') {
    throw new Error('message_end 后未找到持久化消息')
  }
  if (
    entry.message.role !== expected.role
    || entry.message.timestamp !== expected.timestamp
    || !isPiMessage(entry.message)
  ) {
    throw new Error('message_end 与持久化 leaf 不一致')
  }
  const createdAt = Date.parse(entry.timestamp)
  if (!Number.isFinite(createdAt)) {
    throw new Error(`持久化消息时间戳无效：${entry.timestamp}`)
  }
  return {
    id: entry.id,
    createdAt,
    message: entry.message,
  }
}

function lastAssistantStopReason(messages: AgentMessage[]): StopReason {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'assistant') return message.stopReason
  }
  return 'stop'
}

function isPiMessage(message: AgentMessage): message is PiMessage {
  return (
    message.role === 'user'
    || message.role === 'assistant'
    || message.role === 'toolResult'
  )
}

function extractDetails(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result)) return undefined
  return isRecord(result.details) ? result.details : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createPiAgentEngine(
  options: CreatePiAgentEngineOptions,
): AgentEngine {
  return new PiAgentEngine(options)
}
