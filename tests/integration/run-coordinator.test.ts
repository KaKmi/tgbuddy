import { describe, expect, test } from 'bun:test'
import {
  createRunCoordinator,
  type AgentEngine,
  type AgentInvocation,
} from '../../src/runtime/index.ts'
import type {
  AgentEvent,
  StreamFrame,
} from '../../src/shared/contracts/events.ts'

function invocation(sessionId: string, text: string): AgentInvocation {
  return {
    sessionId,
    text,
    workspaceId: 'ws-1',
    cwd: 'C:\\fixture',
    channel: {
      id: 'test',
      name: 'Test',
      protocol: 'openai',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      models: [{
        id: 'test-model',
        name: 'Test Model',
        contextWindow: 4096,
        maxTokens: 1024,
      }],
    },
    modelId: 'test-model',
    systemPrompt: '测试',
  }
}

describe('RunCoordinator + fake AgentEngine', () => {
  test('保持文本流事件顺序并补齐 sessionId/runId/agent channel', async () => {
    const emitted: AgentEvent[] = [
      { type: 'run_start' },
      { type: 'turn_start' },
      { type: 'thinking_delta', delta: '分析' },
      { type: 'text_delta', delta: '完成' },
      {
        type: 'message_end',
        message: {
          kind: 'kernel',
          id: 'message-1',
          createdAt: 100,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '完成' }],
            api: 'openai-completions',
            provider: 'test',
            model: 'test-model',
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: 'stop',
            timestamp: 100,
          },
        },
      },
      { type: 'turn_end' },
      { type: 'run_end', stopReason: 'stop' },
    ]
    const engine: AgentEngine = {
      async *run() {
        for (const event of emitted) yield event
      },
      async dispose() {},
    }
    const frames: StreamFrame[] = []
    const coordinator = createRunCoordinator({
      now: () => 1,
      engine,
      createInvocation: (input) =>
        Promise.resolve(invocation(input.sessionId, input.text)),
      lifecycle: {
        started: (sessionId) => Promise.resolve({
          id: sessionId,
          title: '测试',
          status: 'running',
          createdAt: 1,
          updatedAt: 2,
        }),
        settled: ({ sessionId, status, detail }) => Promise.resolve({
          id: sessionId,
          title: '测试',
          status,
          ...(detail ? { statusDetail: detail } : {}),
          createdAt: 1,
          updatedAt: 3,
        }),
      },
    })

    await coordinator.start(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    const agentFrames = frames.filter(
      (frame) => frame.payload.channel === 'agent',
    )
    expect(agentFrames).toHaveLength(emitted.length)
    expect(
      agentFrames.map((frame) => [
        frame.sessionId,
        frame.runId,
        frame.payload.channel,
      ]),
    ).toEqual(
      emitted.map(() => ['session-1', 1, 'agent']),
    )
    expect(
      agentFrames.map((frame) =>
        frame.payload.channel === 'agent'
          ? frame.payload.event.type
          : frame.payload.event.type),
    ).toEqual(emitted.map((event) => event.type))
  })

  test('createInvocation 抛出工作区 mount 错误时 settled failed 并发出可见 host_error', async () => {
    const frames: StreamFrame[] = []
    const settlements: string[] = []
    let engineCalls = 0
    const engine: AgentEngine = {
      async *run() {
        engineCalls += 1
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 1,
      engine,
      createInvocation: async () => {
        throw new Error('工作区目录不存在：C:\\gone。请恢复目录或重新选择文件夹')
      },
      lifecycle: {
        started: (sessionId) => Promise.resolve({
          id: sessionId,
          title: '测试',
          status: 'running',
          createdAt: 1,
          updatedAt: 2,
        }),
        settled: ({ sessionId, status, detail }) => {
          settlements.push(`${sessionId}:${status}:${detail ?? ''}`)
          return Promise.resolve({
            id: sessionId,
            title: '测试',
            status,
            ...(detail ? { statusDetail: detail } : {}),
            createdAt: 1,
            updatedAt: 3,
          })
        },
      },
    })

    await coordinator.start(
      { sessionId: 'session-1', text: '开始' },
      (frame) => frames.push(frame),
    )

    expect(settlements).toEqual([
      'session-1:failed:工作区目录不存在：C:\\gone。请恢复目录或重新选择文件夹',
    ])
    expect(
      frames.some(
        (frame) =>
          frame.payload.channel === 'host'
          && frame.payload.event.type === 'host_error'
          && frame.payload.event.message.includes('工作区目录不存在'),
      ),
    ).toBe(true)
    expect(engineCalls).toBe(0)
  })
})
