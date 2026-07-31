import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'

interface ChatMessage {
  role?: unknown
  content?: unknown
}

interface ChatRequest {
  messages?: unknown
}

interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: unknown[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

const MODEL_ID = 'e2e-model'
let toolCallSequence = 0

export interface FakeOpenAiServer {
  baseUrl: string
  close(): Promise<void>
}

/**
 * 只替代第三方模型边界，pi AgentHarness、工具执行和持久化仍运行真实实现。
 */
export async function startFakeOpenAiServer(): Promise<FakeOpenAiServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('E2E 模型服务没有取得监听端口')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => closeServer(server),
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }

  try {
    const body = parseChatRequest(await readBody(request))
    const messages = Array.isArray(body.messages)
      ? body.messages.filter(isChatMessage)
      : []
    const latestUserText = [...messages]
      .reverse()
      .find((message) => message.role === 'user')
    const prompt = latestUserText ? messageText(latestUserText) : ''
    const isSummary = messages.some(
      (message) =>
        message.role === 'system'
        && /summar|summary|摘要/i.test(messageText(message)),
    )
    const lastMessage = messages.at(-1)

    beginEventStream(response)
    if (isSummary) {
      await streamText(response, 'E2E 压缩摘要：保留已完成任务、关键决定和后续上下文。')
      return
    }
    if (prompt.includes('慢速')) {
      setTimeout(() => {
        if (!response.destroyed) {
          void streamText(response, '这段迟到文本不应在停止后出现')
        }
      }, 8_000)
      return
    }
    if (prompt.includes('工具读取')) {
      if (lastMessage?.role === 'tool') {
        await streamText(response, '工具读取完成')
      } else {
        streamToolCall(
          response,
          'read',
          { path: 'README.md' },
          'call_e2e_read',
        )
      }
      return
    }
    if (prompt.includes('压缩素材')) {
      if (lastMessage?.role === 'tool') {
        await streamText(response, `压缩素材完成：${prompt}`)
      } else {
        streamToolCall(
          response,
          'read',
          { path: 'LARGE.txt' },
          'call_e2e_read',
        )
      }
      return
    }
    if (prompt.includes('M2 写入')) {
      if (lastMessage?.role === 'tool') {
        await streamText(response, 'M2 写入完成')
      } else {
        streamToolCall(
          response,
          'write',
          { path: 'm2-write.txt', content: 'M2 写入内容' },
          'call_e2e_write',
        )
      }
      return
    }
    if (prompt.includes('M2 删除')) {
      if (lastMessage?.role === 'tool') {
        await streamText(response, 'M2 删除完成')
      } else {
        streamToolCall(
          response,
          'delete',
          { paths: ['m2-delete.txt'] },
          'call_e2e_delete',
        )
      }
      return
    }
    if (prompt.includes('排队消息')) {
      await streamText(response, '排队消息已在压缩后执行')
      return
    }

    const highUsage = prompt.includes('触发自动压缩')
    await streamText(response, `E2E 回复：${prompt}`, { highUsage })
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined)
      return
    }
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    }))
  }
}

function beginEventStream(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}

async function streamText(
  response: ServerResponse,
  text: string,
  options: { highUsage?: boolean } = {},
): Promise<void> {
  const splitAt = Math.max(1, Math.floor(text.length / 2))
  writeChunk(response, {
    choices: [{
      index: 0,
      delta: { role: 'assistant', content: text.slice(0, splitAt) },
      finish_reason: null,
    }],
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
  if (response.destroyed) return
  writeChunk(response, {
    choices: [{
      index: 0,
      delta: { content: text.slice(splitAt) },
      finish_reason: null,
    }],
  })
  writeChunk(response, {
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop',
    }],
  })
  writeUsageAndEnd(response, options.highUsage ? 900_000 : 1_000)
}

function streamToolCall(
  response: ServerResponse,
  toolName: string,
  args: Record<string, unknown>,
  idPrefix: string,
): void {
  toolCallSequence += 1
  writeChunk(response, {
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: `${idPrefix}_${toolCallSequence}`,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args),
          },
        }],
      },
      finish_reason: null,
    }],
  })
  writeChunk(response, {
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'tool_calls',
    }],
  })
  writeUsageAndEnd(response, 1_000)
}

function writeUsageAndEnd(response: ServerResponse, totalTokens: number): void {
  writeChunk(response, {
    choices: [],
    usage: {
      prompt_tokens: Math.max(0, totalTokens - 20),
      completion_tokens: 20,
      total_tokens: totalTokens,
    },
  })
  response.write('data: [DONE]\n\n')
  response.end()
}

function writeChunk(
  response: ServerResponse,
  value: Pick<ChatCompletionChunk, 'choices' | 'usage'>,
): void {
  const chunk: ChatCompletionChunk = {
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1_000),
    model: MODEL_ID,
    choices: value.choices,
    ...(value.usage ? { usage: value.usage } : {}),
  }
  response.write(`data: ${JSON.stringify(chunk)}\n\n`)
}

function parseChatRequest(raw: string): ChatRequest {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new Error('模型请求不是对象')
  return parsed
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => {
      if (!isRecord(part)) return ''
      return typeof part.text === 'string' ? part.text : ''
    })
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}
