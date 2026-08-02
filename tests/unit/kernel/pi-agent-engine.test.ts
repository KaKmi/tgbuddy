import { describe, expect, test } from 'bun:test'
import type {
  AgentHarnessEvent,
  AgentMessage,
} from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  Usage,
  UserMessage,
} from '@earendil-works/pi-ai'
import {
  mergeCompactedContext,
  piEventToAgentEvent,
  piMessageFailureEvent,
  type PersistedPiMessage,
} from '../../../src/kernel/pi/index.ts'

const usage: Usage = {
  input: 2,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

function assistant(
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '完成' }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage,
    stopReason,
    timestamp: 200,
  }
}

describe('PiAgentEngine 事件适配', () => {
  test('透传 thinking/text/error，错误不会静默', () => {
    const message = assistant('error')
    const events: AgentHarnessEvent[] = [
      {
        type: 'message_update',
        message,
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: '分析',
          partial: message,
        },
      },
      {
        type: 'message_update',
        message,
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: '正文',
          partial: message,
        },
      },
      {
        type: 'message_update',
        message,
        assistantMessageEvent: {
          type: 'error',
          reason: 'error',
          error: {
            ...message,
            errorMessage: '认证失败',
          },
        },
      },
    ]

    expect(events.map((event) => piEventToAgentEvent(event))).toEqual([
      { type: 'thinking_delta', delta: '分析' },
      { type: 'text_delta', delta: '正文' },
      { type: 'error', reason: 'error', message: '认证失败' },
    ])
  })

  test('message_end 使用已经提交的 entry 信封', () => {
    const message = assistant()
    const persisted: PersistedPiMessage = {
      id: 'entry-1',
      createdAt: 300,
      message,
    }

    expect(piEventToAgentEvent({
      type: 'message_end',
      message,
    }, persisted)).toEqual({
      type: 'message_end',
      message: {
        kind: 'kernel',
        id: 'entry-1',
        createdAt: 300,
        message,
      },
    })
  })

  test('工具事件保留参数、进度、结果预览和 details', () => {
    const events: AgentHarnessEvent[] = [
      {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
      },
      {
        type: 'tool_execution_update',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
        partialResult: { content: [{ type: 'text', text: '读取中' }] },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'read',
        result: {
          content: [{ type: 'text', text: '读取完成' }],
          details: { action: 'read', path: 'README.md' },
        },
        isError: false,
      },
    ]

    expect(events.map((event) => piEventToAgentEvent(event))).toEqual([
      {
        type: 'tool_start',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
      },
      {
        type: 'tool_progress',
        toolCallId: 'call-1',
        partial: { content: [{ type: 'text', text: '读取中' }] },
      },
      {
        type: 'tool_end',
        toolCallId: 'call-1',
        isError: false,
        output: '读取完成',
        details: { action: 'read', path: 'README.md' },
      },
    ])
  })

  test('目录读取错误映射为可修复调用错误，其它错误保持执行失败', () => {
    expect(piEventToAgentEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-directory',
      toolName: 'read',
      result: {
        content: [{ type: 'text', text: 'EISDIR: illegal operation on a directory, read' }],
        details: {},
      },
      isError: true,
    })).toEqual({
      type: 'tool_end',
      toolCallId: 'call-directory',
      isError: true,
      output: 'EISDIR: illegal operation on a directory, read',
      details: {},
      reason: {
        kind: 'invalid_invocation',
        code: 'directory_requires_list',
        repairHint: '请改用 glob 或 list',
      },
    })

    expect(piEventToAgentEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-failed',
      toolName: 'bash',
      result: {
        content: [{ type: 'text', text: 'Command exited with code 2' }],
        details: {},
      },
      isError: true,
    })).toMatchObject({
      type: 'tool_end',
      reason: {
        kind: 'execution',
        code: 'tool_execution_failed',
        retryable: false,
      },
    })
  })

  test('provider 只在最终 assistant 写错误时补发 error 事件', () => {
    expect(piMessageFailureEvent({
      ...assistant('error'),
      errorMessage: '401 authentication failed',
    })).toEqual({
      type: 'error',
      reason: 'error',
      message: '401 authentication failed',
    })
  })

  test('run_end 取最后一条 assistant 的真实 stopReason', () => {
    const user: UserMessage = {
      role: 'user',
      content: '开始',
      timestamp: 100,
    }
    const messages: AgentMessage[] = [
      user,
      assistant('length'),
    ]

    expect(piEventToAgentEvent({
      type: 'agent_end',
      messages,
    })).toEqual({
      type: 'run_end',
      stopReason: 'length',
    })
  })

  test('没有 assistant 时以正常 stop 收口', () => {
    const user: UserMessage = {
      role: 'user',
      content: '开始',
      timestamp: 100,
    }

    expect(piEventToAgentEvent({
      type: 'agent_end',
      messages: [user],
    })).toEqual({
      type: 'run_end',
      stopReason: 'stop',
    })
  })

  test('压缩后的模型上下文不会在后续工具轮次带回旧历史', () => {
    const oldMessages: AgentMessage[] = [
      { role: 'user', content: '旧一', timestamp: 1 },
      { role: 'user', content: '旧二', timestamp: 2 },
    ]
    const summary: AgentMessage = {
      role: 'compactionSummary',
      summary: '旧历史摘要',
      tokensBefore: 20_000,
      timestamp: 3,
    }
    const fresh: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text', text: '新结果' }],
      isError: false,
      timestamp: 4,
    }

    expect(mergeCompactedContext([...oldMessages, fresh], {
      base: [summary],
      sourceMessageCount: oldMessages.length,
    })).toEqual([summary, fresh])
  })
})
