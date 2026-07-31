import {
  AgentHarness,
  type AgentHarnessEvent,
  type AgentMessage,
  type AgentTool,
  type ExecutionEnv,
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
  ToolPolicy,
} from '../../runtime/runs/agent-engine.ts'
import type { AttachmentRef } from '../../shared/contracts/attachment.ts'
import type { BlobRef } from '../../shared/contracts/blob.ts'
import { preparePromptWithAttachments } from './pi-attachment-content.ts'
import { prepareToolOutputPreview } from './pi-tool-output.ts'
import type {
  RunExecutionEnv,
  RunExecutionEnvFactory,
} from '../../runtime/execution-env/run-execution-env.ts'
import { PiRunExecutionEnv } from './pi-execution-env.ts'
import { estimateModelCallContextTokens } from './pi-compaction.ts'
import {
  estimateTextTokens,
  estimateToolTokens,
} from './pi-context-usage.ts'
import { buildModels } from './pi-models.ts'

export interface PiAgentSessionProvider {
  openHarnessSession(
    sessionId: string,
    kernel: string,
  ): Promise<Session | undefined>
}

export interface CreatePiAgentEngineOptions {
  sessions: PiAgentSessionProvider
  /** 每个 Run 创建独立沙箱环境，run settled 后释放 */
  envFactory: RunExecutionEnvFactory
  tools(invocation: AgentInvocation, env: ExecutionEnv): AgentTool[]
  toolPolicy: ToolPolicy
  /**
   * A02：用户消息持久化后把附件 ref 写入 app_attachments（按 entry_id）。
   * 附件是应用元数据，不进 pi 消息本体；失败时只记诊断，不阻断 Run。
   */
  persistAttachments?(
    sessionId: string,
    entryId: string,
    refs: AttachmentRef[],
  ): void
  /**
   * A03：按 BlobRef 读回附件字节（Composition Root 注入 BlobStore.get）。
   * 缺失/读取失败时只记诊断，不阻断 Run。
   */
  loadAttachment?(ref: AttachmentRef['blob']): Promise<Uint8Array>
  /**
   * A04：工具输出超过 256KB 时把完整内容落 BlobStore（Composition Root 注入）。
   * 失败时只记诊断，模型/消息仍收到截断预览。
   */
  storeToolOutput?(
    sessionId: string,
    toolCallId: string,
    text: string,
  ): Promise<BlobRef>
  /**
   * A05：成功的产出型工具（write/edit）从 args 投影 Artifact。
   * Runtime 侧决定是否产出并写索引；失败/纯读工具不触发。
   */
  projectArtifact?(
    sessionId: string,
    workspaceId: string | undefined,
    input: { toolName: string; args: Record<string, unknown>; isError: boolean },
  ): void
}

export interface PersistedPiMessage {
  id: string
  createdAt: number
  message: PiMessage
  /** A02：用户消息携带的附件 ref（渲染层消息信封用） */
  attachments?: AttachmentRef[]
}

export interface CompactedContextCursor {
  base: AgentMessage[]
  sourceMessageCount: number
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
  readonly #tools: CreatePiAgentEngineOptions['tools']
  readonly #envFactory: RunExecutionEnvFactory
  readonly #toolPolicy: ToolPolicy
  readonly #persistAttachments: CreatePiAgentEngineOptions['persistAttachments']
  readonly #loadAttachment: CreatePiAgentEngineOptions['loadAttachment']
  readonly #storeToolOutput: CreatePiAgentEngineOptions['storeToolOutput']
  readonly #projectArtifact: CreatePiAgentEngineOptions['projectArtifact']
  readonly #active = new Map<string, AgentHarness>()
  #disposed = false

  constructor(options: CreatePiAgentEngineOptions) {
    this.#sessions = options.sessions
    this.#tools = options.tools
    this.#envFactory = options.envFactory
    this.#toolPolicy = options.toolPolicy
    this.#persistAttachments = options.persistAttachments
    this.#loadAttachment = options.loadAttachment
    this.#storeToolOutput = options.storeToolOutput
    this.#projectArtifact = options.projectArtifact
  }

  async *run(
    invocation: AgentInvocation,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    if (this.#disposed) throw new Error('PiAgentEngine 已关闭')
    if (signal.aborted) return
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
    if (signal.aborted) return

    const models = buildModels([invocation.channel])
    const model = models.getModel(invocation.channel.id, invocation.modelId)
    if (!model) {
      throw new Error(
        `模型未注册：${invocation.channel.id}/${invocation.modelId}`,
      )
    }
    if (signal.aborted) return

    const runEnv = this.#envFactory.create({
      workspaceId: invocation.workspaceId,
      mountPath: invocation.cwd,
    })
    try {
      const tools = this.#tools(invocation, this.#piEnv(runEnv))
      const harness = new AgentHarness({
        session,
        models,
        model,
        systemPrompt: invocation.systemPrompt,
        tools,
      })
      const events = new AsyncEventQueue<AgentEvent>()
      let promptSettled = false
      let promptFailed = false
      let promptError: unknown
      let sawErrorEvent = false
      let abortPromise: Promise<void> | undefined
      const pendingAttachments =
        invocation.attachments && invocation.attachments.length > 0
          ? [...invocation.attachments]
          : undefined

      const unsubscribeToolPolicy = harness.on('tool_call', async (event) => {
        const decision = await this.#toolPolicy.evaluate({
          sessionId: invocation.sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.input,
        }, signal)
        return decision.action === 'deny'
          ? { block: true, reason: decision.reason }
          : undefined
      })
      // A04：超长工具输出落 Blob，消息/模型只收 8 行尾部预览 + ref
      const unsubscribeToolOutput = harness.on('tool_result', async (event) => {
        if (!event.isError) {
          // A05：成功结果投影产物（write/edit 等），失败不投影
          try {
            this.#projectArtifact?.(
              invocation.sessionId,
              invocation.workspaceId,
              {
                toolName: event.toolName,
                args: event.input,
                isError: event.isError,
              },
            )
          } catch (error) {
            console.error('[PiAgentEngine] Artifact 投影失败：', error)
          }
        }
        const preview = await prepareToolOutputPreview({
          content: event.content,
          sessionId: invocation.sessionId,
          toolCallId: event.toolCallId,
          store: (sessionId, toolCallId, text) => {
            if (!this.#storeToolOutput) throw new Error('长输出存储未配置')
            return this.#storeToolOutput(sessionId, toolCallId, text)
          },
        })
        if (!preview) return undefined
        return {
          content: [{ type: 'text', text: preview.text }],
          details: {
            ...(isRecord(event.details) ? event.details : {}),
            ...(preview.outputRef ? { outputRef: preview.outputRef } : {}),
          },
        }
      })
      const fixedContextTokens =
        estimateTextTokens(invocation.systemPrompt)
        + estimateToolTokens(tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })))
      let compactedContext: CompactedContextCursor | undefined
      const unsubscribeContextGuard = harness.on('context', async (event) => {
        if (!invocation.beforeModelCall) return undefined
        const current = mergeCompactedContext(event.messages, compactedContext)
        const compacted = await invocation.beforeModelCall(
          estimateModelCallContextTokens(current, fixedContextTokens),
          model.contextWindow,
        )
        if (!compacted) {
          return compactedContext ? { messages: current } : undefined
        }
        const base = (await session.buildContext()).messages
        compactedContext = {
          base,
          sourceMessageCount: event.messages.length,
        }
        return { messages: base }
      })
      const unsubscribe = harness.subscribe(async (event) => {
        const persisted = event.type === 'message_end'
          ? await persistedMessage(session, event.message)
          : undefined
        if (
          persisted
          && persisted.message.role === 'user'
          && pendingAttachments
        ) {
          // 用户消息落库后挂附件：写 app_attachments 供历史回放；失败不阻断 Run
          persisted.attachments = pendingAttachments
          try {
            this.#persistAttachments?.(
              invocation.sessionId,
              persisted.id,
              pendingAttachments,
            )
          } catch (error) {
            console.error('[PiAgentEngine] 附件元数据写入失败：', error)
          }
        }
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
      const abortHarness = (): void => {
        abortPromise ??= harness.abort().then(
          () => undefined,
          () => undefined,
        )
      }
      signal.addEventListener('abort', abortHarness, { once: true })
      // A03：附件转模型内容。图片走 pi 原生 prompt(text, {images})，
      // 文本附件前置到正文；缺失/不支持/模型不支持图片时只注入诊断文本。
      const { text: promptText, images } = await preparePromptWithAttachments({
        text: invocation.text,
        attachments: pendingAttachments,
        load: this.#loadAttachment,
        modelSupportsImages: model.input.includes('image'),
      })
      const prompt = (signal.aborted
        ? Promise.resolve()
        : harness.prompt(promptText, { ...(images.length > 0 ? { images } : {}) }))
        .then(() => undefined, (error: unknown) => {
          promptFailed = true
          promptError = error
        })
        .finally(() => {
          promptSettled = true
          events.close()
        })
      if (signal.aborted) abortHarness()

      try {
        for await (const event of events) yield event
        await prompt
        if (promptFailed) throw promptError
      } finally {
        signal.removeEventListener('abort', abortHarness)
        unsubscribeContextGuard()
        unsubscribeToolPolicy()
        unsubscribeToolOutput()
        unsubscribe()
        if (this.#active.get(invocation.sessionId) === harness) {
          this.#active.delete(invocation.sessionId)
        }
        if (!promptSettled) {
          await harness.abort()
          await prompt
        }
        await abortPromise
      }
    } finally {
      await runEnv.dispose()
    }
  }

  /**
   * 把 pi-free 端口收窄到 kernel 具体类型：PiRunExecutionEnv 是
   * RunExecutionEnvFactory 的唯一实现，pi 类型只出现在 kernel 层。
   */
  #piEnv(runEnv: RunExecutionEnv): ExecutionEnv {
    if (!(runEnv instanceof PiRunExecutionEnv)) {
      throw new Error('不支持的 RunExecutionEnv 实现')
    }
    return runEnv.env
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
      const output = extractToolOutput(event.result)
      return {
        type: 'tool_end',
        toolCallId: event.toolCallId,
        isError: event.isError,
        ...(output ? { output } : {}),
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

function extractToolOutput(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) return undefined
  const text = result.content
    .map((item) =>
      isRecord(item) && item.type === 'text' && typeof item.text === 'string'
        ? item.text
        : '',
    )
    .join('')
    .trim()
  return text || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createPiAgentEngine(
  options: CreatePiAgentEngineOptions,
): AgentEngine {
  return new PiAgentEngine(options)
}

/**
 * Agent loop 会保留本次 Run 开始时的内存历史；压缩后用新的持久化基线替换旧前缀，
 * 再拼接本 Run 后续产生的消息，避免下一轮工具调用把已压缩原文带回来。
 */
export function mergeCompactedContext(
  source: AgentMessage[],
  cursor?: CompactedContextCursor,
): AgentMessage[] {
  return cursor
    ? [...cursor.base, ...source.slice(cursor.sourceMessageCount)]
    : source
}
