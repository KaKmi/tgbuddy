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
  piEventToAgentEvent,
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
})
