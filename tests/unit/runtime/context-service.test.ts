import { describe, expect, test } from 'bun:test'
import {
  createContextService,
} from '../../../src/runtime/context/context-service.ts'
import type {
  ContextCompactor,
  ContextUsageEstimateInput,
  PreparedContextCompaction,
} from '../../../src/runtime/context/ports/context-compactor.ts'
import type {
  AppendCompactionInput,
  SessionMessageHistory,
} from '../../../src/runtime/sessions/session-message-history.ts'
import type { Channel } from '../../../src/shared/contracts/channel.ts'
import type { ContextUsage } from '../../../src/shared/contracts/context.ts'
import type { StreamFrame } from '../../../src/shared/contracts/events.ts'
import type {
  CompactionMessage,
  SessionMessage,
} from '../../../src/shared/contracts/message.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'

const CHANNEL: Channel = {
  id: 'channel-1',
  name: '测试渠道',
  protocol: 'openai',
  baseUrl: 'https://example.com',
  apiKey: 'test',
  models: [{
    id: 'model-1',
    name: '测试模型',
    contextWindow: 100_000,
    maxTokens: 8_000,
  }],
}

const USAGE: ContextUsage = {
  usedTokens: 500,
  contextWindow: 100_000,
  percent: 0.5,
  breakdown: {
    systemPrompt: 100,
    tools: 100,
    messages: 300,
    skills: 0,
    mcp: 0,
  },
  outputTokens: 20,
  costUsd: 0.01,
  updatedAt: 100,
}

interface Fixture {
  frames: StreamFrame[]
  messages: SessionMessage[]
  session: SessionMeta
  appended: AppendCompactionInput[]
  usageInputs: ContextUsageEstimateInput[]
  history: SessionMessageHistory
}

function createFixture(): Fixture {
  const frames: StreamFrame[] = []
  const appended: AppendCompactionInput[] = []
  const usageInputs: ContextUsageEstimateInput[] = []
  const session: SessionMeta = {
    id: 'session-1',
    title: '测试会话',
    channelId: CHANNEL.id,
    modelId: 'model-1',
    contextUsage: {
      ...USAGE,
      usedTokens: 90_000,
      percent: 90,
    },
    createdAt: 1,
    updatedAt: 1,
  }
  const messages: SessionMessage[] = [
    userMessage('message-1', '旧消息一', 1),
    userMessage('message-2', '旧消息二', 2),
    userMessage('message-3', '保留消息', 3),
  ]

  const history: SessionMessageHistory = {
    async create() {},
    async messages() {
      return [...messages]
    },
    async compactedMessages() {
      return []
    },
    async compactionSourceEntries() {
      return messages.map((message) => {
        if (message.kind === 'compaction') {
          return {
            type: 'compaction' as const,
            id: message.id,
            timestamp: message.createdAt,
            summary: message.summary,
            firstKeptEntryId: message.firstKeptEntryId,
            tokensBefore: message.tokensBefore,
            compactedCount: message.compactedCount,
          }
        }
        return {
          type: 'message' as const,
          id: message.id,
          timestamp: message.createdAt,
          message,
        }
      })
    },
    async append() {},
    async appendCompaction(_sessionId, input) {
      appended.push(input)
      const marker: CompactionMessage = {
        kind: 'compaction',
        id: 'compaction-1',
        createdAt: 4,
        summary: input.summary,
        compactedCount: 2,
        tokensBefore: input.tokensBefore,
        firstKeptEntryId: input.firstKeptEntryId,
      }
      messages.splice(0, messages.length, marker, messages[2]!)
      return marker
    },
    async countArtifacts() {
      return 0
    },
    async delete() {},
  }

  return {
    frames,
    messages,
    session,
    appended,
    usageInputs,
    history,
  }
}

function createCompactor(
  fixture: Fixture,
  execute: PreparedContextCompaction['execute'] = async () => ({
      summary: '压缩摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 90_000,
      outputTokens: 20,
      costUsd: 0.01,
    }),
): ContextCompactor {
  return {
    prepare() {
      return {
        compactedCount: 2,
        contextWindow: 100_000,
        execute,
      }
    },
    estimateUsage(input) {
      fixture.usageInputs.push(input)
      return USAGE
    },
  }
}

function createService(
  fixture: Fixture,
  compactor: ContextCompactor,
) {
  return createContextService({
    sessions: {
      list: () => [fixture.session],
      updateMeta(_sessionId, patch) {
        Object.assign(fixture.session, patch)
        return fixture.session
      },
    },
    history: fixture.history,
    channels: { list: () => [CHANNEL] },
    compactor,
  })
}

function emitTo(fixture: Fixture): (frame: StreamFrame) => void {
  return (frame) => fixture.frames.push(frame)
}

function hostEventTypes(frames: StreamFrame[]): string[] {
  return frames.flatMap((frame) =>
    frame.payload.channel === 'host' ? [frame.payload.event.type] : [],
  )
}

describe('ContextService', () => {
  test('手动压缩成功后持久化摘要，并使用压缩后的历史重建上下文用量', async () => {
    const fixture = createFixture()
    const service = createService(fixture, createCompactor(fixture))

    await service.start('session-1', emitTo(fixture))

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_start',
      'compaction_end',
    ])
    expect(fixture.appended).toEqual([{
      summary: '压缩摘要',
      firstKeptEntryId: 'message-3',
      tokensBefore: 90_000,
    }])
    expect(fixture.usageInputs[0]?.messages.map((message) => message.id)).toEqual([
      'compaction-1',
      'message-3',
    ])
    expect(fixture.session.contextUsage).toEqual(USAGE)
    expect(service.isCompacting('session-1')).toBe(false)
  })

  test('准备压缩失败时发布可恢复错误且不进入运行态', async () => {
    const fixture = createFixture()
    const compactor = createCompactor(fixture)
    compactor.prepare = () => {
      throw new Error('上下文还很短')
    }
    const service = createService(fixture, compactor)

    await service.start('session-1', emitTo(fixture))

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_cancelled',
      'host_error',
    ])
    expect(service.isCompacting('session-1')).toBe(false)
  })

  test('摘要执行失败时结束运行态并发布错误', async () => {
    const fixture = createFixture()
    const service = createService(
      fixture,
      createCompactor(fixture, async () => {
        throw new Error('模型不可用')
      }),
    )

    await service.start('session-1', emitTo(fixture))

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_start',
      'compaction_cancelled',
      'host_error',
    ])
    expect(fixture.appended).toHaveLength(0)
  })

  test('取消正在执行的摘要时只发布取消事件，不误报模型失败', async () => {
    const fixture = createFixture()
    let started = (): void => {}
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const service = createService(
      fixture,
      createCompactor(fixture, (signal) =>
        new Promise((_resolve, reject) => {
          started()
          signal.addEventListener('abort', () => reject(new Error('已中止')), {
            once: true,
          })
        })),
    )

    const completion = service.start('session-1', emitTo(fixture))
    await ready
    service.cancel('session-1', emitTo(fixture))
    await completion

    expect(hostEventTypes(fixture.frames)).toEqual([
      'compaction_start',
      'compaction_cancelled',
    ])
    expect(fixture.appended).toHaveLength(0)
  })
})

function userMessage(
  id: string,
  text: string,
  createdAt: number,
): SessionMessage {
  return {
    kind: 'kernel',
    id,
    createdAt,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: createdAt,
    },
  }
}
