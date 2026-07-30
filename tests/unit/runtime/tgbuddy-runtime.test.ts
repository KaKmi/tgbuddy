import { describe, expect, test } from 'bun:test'
import {
  createTgBuddyRuntime,
  type RuntimeDependencies,
} from '../../../src/runtime/index.ts'
import type { RuntimeEvent } from '../../../src/runtime/index.ts'

function createDependencies(calls: string[]): RuntimeDependencies {
  return {
    workspaces: {
      list: () => [],
    },
    sessions: {
      list: () => [],
      create: async () => ({
        id: 'session-1',
        title: '新会话',
        createdAt: 1,
        updatedAt: 1,
      }),
      delete: async () => {
        calls.push('session.delete')
      },
      messages: async () => [],
      compactedMessages: async () => [],
      updateMeta: () => calls.push('session.updateMeta'),
    },
    runs: {
      async send(_input, emit) {
        calls.push('run.send')
        emit({
          sessionId: 'session-1',
          runId: 1,
          payload: { channel: 'agent', event: { type: 'run_start' } },
        })
      },
      stop: () => calls.push('run.stop'),
      isRunning: () => false,
    },
    permissions: {
      respond: () => calls.push('permission.respond'),
      pending: () => [],
      expireSessionRules: () => calls.push('permission.expire'),
    },
    plans: {
      respond: () => calls.push('plan.respond'),
      pending: () => [],
      setMode: () => calls.push('plan.setMode'),
    },
    questions: {
      respond: () => calls.push('question.respond'),
      pending: () => [],
    },
    context: {
      async start() {
        calls.push('context.start')
      },
      defer: () => calls.push('context.defer'),
      cancel: () => calls.push('context.cancel'),
      clearSession: () => calls.push('context.clear'),
    },
    artifacts: {
      list: () => [],
    },
    capabilities: {
      list: () => [],
    },
    settings: {
      listChannels: () => [],
      saveChannel: () => calls.push('settings.save'),
      deleteChannel: () => calls.push('settings.delete'),
      async testChannel() {
        return { success: false, message: '未实现' }
      },
    },
  }
}

describe('TgBuddyRuntime 门面', () => {
  test('删除会话保持旧实现的清理顺序', async () => {
    const calls: string[] = []
    const runtime = createTgBuddyRuntime(createDependencies(calls))

    await runtime.sessions.delete('session-1')

    expect(calls).toEqual(['context.clear', 'session.delete', 'permission.expire'])
  })

  test('运行事件和宿主响应只通过统一订阅契约发布', async () => {
    const calls: string[] = []
    const events: RuntimeEvent[] = []
    const runtime = createTgBuddyRuntime(createDependencies(calls))
    runtime.subscribe((event) => events.push(event))

    runtime.runs.send({ sessionId: 'session-1', text: '你好' })
    runtime.permissions.respond({
      requestId: 'request-1',
      allowed: true,
    })
    await Promise.resolve()

    expect(calls).toEqual(['run.send', 'permission.respond'])
    expect(events).toEqual([
      {
        sessionId: 'session-1',
        runId: 1,
        payload: { channel: 'agent', event: { type: 'run_start' } },
      },
      {
        sessionId: '',
        runId: 0,
        payload: {
          channel: 'host',
          event: {
            type: 'permission_resolved',
            requestId: 'request-1',
            allowed: true,
          },
        },
      },
    ])
  })
})
