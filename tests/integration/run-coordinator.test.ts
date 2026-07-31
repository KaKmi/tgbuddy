import { describe, expect, test } from 'bun:test'
import {
  createRunCoordinator,
  MemoryRunRepository,
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

  test('C12：settled 时一次提交能力快照与分类 token 账本', async () => {
    const runs = new MemoryRunRepository()
    const engine: AgentEngine = {
      async *run() {
        yield {
          type: 'turn_end',
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 0,
            totalTokens: 17,
            cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0, total: 3.5 },
          },
        }
        yield {
          type: 'turn_end',
          usage: {
            input: 3,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 5,
            cost: { input: 0.3, output: 0.8, cacheRead: 0, cacheWrite: 0, total: 1.1 },
          },
        }
        yield { type: 'run_end', stopReason: 'stop' }
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 100,
      engine,
      runs,
      createRunId: () => 'run-1',
      createInvocation: (input) =>
        Promise.resolve({
          ...invocation(input.sessionId, input.text),
          tools: [
            {
              id: 'read',
              name: 'read',
              label: '读取文件',
              description: '读',
              category: 'builtin',
              source: '内置',
              defaultPermission: 'allow',
              enabled: true,
            },
            {
              id: 'pg.query',
              name: 'pg.query',
              label: 'query',
              description: '查询',
              category: 'mcp',
              source: 'postgres',
              owner: 'mcp-1',
              defaultPermission: 'allow',
              enabled: true,
            },
          ],
        }),
      lifecycle: {
        started: (sessionId) =>
          Promise.resolve({ id: sessionId, title: 't', createdAt: 1, updatedAt: 2 }),
        settled: ({ sessionId, status }) =>
          Promise.resolve({ id: sessionId, title: 't', status, createdAt: 1, updatedAt: 3 }),
      },
    })

    await coordinator.start({ sessionId: 'session-1', text: 'go' }, () => {})

    const record = runs.get('run-1')
    expect(record?.status).toBe('done')
    expect(record?.settledAt).toBe(100)
    expect(record?.snapshot?.usage).toEqual({
      inputTokens: 13,
      outputTokens: 7,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      totalTokens: 22,
      costUsd: 4.6,
    })
    expect(record?.snapshot?.tools.map((tool) => tool.id)).toEqual([
      'read',
      'pg.query',
    ])
    expect(record?.snapshot?.mcp).toEqual([
      { serverId: 'mcp-1', name: 'postgres', tools: ['pg.query'] },
    ])
  })

  test('C12：失败 Run 也提交已知账本（usage 归零，error 记录原因）', async () => {
    const runs = new MemoryRunRepository()
    const engine: AgentEngine = {
      async *run() {
        yield { type: 'error', reason: 'error', message: '模型调用失败' }
        yield { type: 'run_end', stopReason: 'error' }
      },
      async dispose() {},
    }
    const coordinator = createRunCoordinator({
      now: () => 200,
      engine,
      runs,
      createRunId: () => 'run-2',
      createInvocation: (input) =>
        Promise.resolve(invocation(input.sessionId, input.text)),
      lifecycle: {
        started: (sessionId) =>
          Promise.resolve({ id: sessionId, title: 't', createdAt: 1, updatedAt: 2 }),
        settled: ({ sessionId, status }) =>
          Promise.resolve({ id: sessionId, title: 't', status, createdAt: 1, updatedAt: 3 }),
      },
    })

    await coordinator.start({ sessionId: 'session-1', text: 'go' }, () => {})

    const record = runs.get('run-2')
    expect(record?.status).toBe('failed')
    expect(record?.error).toContain('模型调用失败')
    expect(record?.snapshot?.usage.totalTokens).toBe(0)
    expect(record?.snapshot?.channel.modelId).toBe('test-model')
  })
})
