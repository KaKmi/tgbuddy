import { describe, expect, test } from 'bun:test'
import {
  createAgentRuntime,
  type AgentRuntimeDependencies,
  type AgentRuntimeEvent,
} from '../../../src/runtime/index.ts'

function createDependencies(calls: string[]): AgentRuntimeDependencies {
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
      truncate: async () => {
        calls.push('session.truncate')
        return []
      },
      clonePrefix: async () => {
        calls.push('session.clonePrefix')
        return {
          id: 'session-clone',
          title: '新会话',
          createdAt: 2,
          updatedAt: 2,
        }
      },
      updateMeta: () => calls.push('session.updateMeta'),
    },
    runs: {
      async start(_input, emit) {
        calls.push('run.start')
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
        return { ok: false, code: 'unknown', message: '未实现' }
      },
      listProfiles: () => [],
      saveProfile: () => calls.push('settings.profile-save'),
      deleteProfile: () => calls.push('settings.profile-delete'),
      listTools: () => [],
      listSkills: () => [],
      setSkillEnabled: () => calls.push('settings.skill-set'),
      listMcpServers: () => [],
      saveMcpServer: () => calls.push('settings.mcp-save'),
      deleteMcpServer: () => calls.push('settings.mcp-delete'),
      async connectMcp() {
        return { serverId: 'mcp-1', state: 'off' }
      },
      async disconnectMcp() {
        calls.push('settings.mcp-disconnect')
      },
      mcpStatuses: () => [],
    },
  }
}

describe('AgentRuntime 门面', () => {
  test('Run 方法通过原 owner 调用，保留 Coordinator 的实例接收者', () => {
    const calls: string[] = []
    const dependencies = createDependencies(calls)
    const owner = {
      active: true,
      start: dependencies.runs.start,
      stop(this: { active: boolean }, sessionId: string) {
        calls.push(`run.stop:${sessionId}:${this.active}`)
      },
      isRunning(this: { active: boolean }, sessionId: string) {
        calls.push(`run.isRunning:${sessionId}:${this.active}`)
        return this.active
      },
    }
    dependencies.runs = owner
    const runtime = createAgentRuntime(dependencies)

    runtime.runs.stop('session-1')

    expect(runtime.runs.isRunning('session-1')).toBe(true)
    expect(calls).toEqual([
      'run.stop:session-1:true',
      'run.isRunning:session-1:true',
    ])
  })

  test('删除会话保持旧实现的清理顺序', async () => {
    const calls: string[] = []
    const runtime = createAgentRuntime(createDependencies(calls))

    await runtime.sessions.delete('session-1')

    expect(calls).toEqual(['context.clear', 'session.delete', 'permission.expire'])
  })

  test('运行事件和宿主响应只通过统一订阅契约发布', async () => {
    const calls: string[] = []
    const events: AgentRuntimeEvent[] = []
    const runtime = createAgentRuntime(createDependencies(calls))
    runtime.subscribe((event) => events.push(event))

    runtime.runs.start({ sessionId: 'session-1', text: '你好' })
    runtime.permissions.respond({
      requestId: 'request-1',
      allowed: true,
    })
    await Promise.resolve()

    expect(calls).toEqual(['run.start', 'permission.respond'])
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

  test('编辑历史前取消压缩状态，并拒绝在 active Run 中截断', async () => {
    const calls: string[] = []
    const dependencies = createDependencies(calls)
    const runtime = createAgentRuntime(dependencies)

    expect(await runtime.sessions.truncate('session-1', 'message-1')).toEqual([])
    expect(calls).toEqual(['context.clear', 'session.truncate'])

    calls.length = 0
    expect(await runtime.sessions.clonePrefix({
      sourceSessionId: 'session-1',
      throughMessageId: 'message-1',
    })).toMatchObject({ id: 'session-clone' })
    expect(calls).toEqual(['session.clonePrefix'])

    calls.length = 0
    dependencies.runs.isRunning = () => true
    await expect(
      runtime.sessions.truncate('session-1', 'message-1'),
    ).rejects.toThrow('任务运行中')
    await expect(runtime.sessions.clonePrefix({
      sourceSessionId: 'session-1',
      throughMessageId: 'message-1',
    })).rejects.toThrow('任务运行中')
    await expect(runtime.sessions.delete('session-1')).rejects.toThrow('任务运行中')
    expect(calls).toEqual([])
  })

  test('计划模式切换持久化到 Session 元数据并发布 mode_changed', () => {
    const calls: string[] = []
    const runtime = createAgentRuntime(createDependencies(calls))
    const events: AgentRuntimeEvent[] = []
    runtime.subscribe((event) => events.push(event))

    runtime.plans.setMode('session-1', 'plan')

    expect(calls).toEqual(['plan.setMode', 'session.updateMeta'])
    expect(events).toContainEqual({
      sessionId: 'session-1',
      runId: 0,
      payload: {
        channel: 'host',
        event: { type: 'mode_changed', mode: 'plan', source: 'user' },
      },
    })
  })

  test('ask_user 响应只通过统一订阅契约发布', async () => {
    const calls: string[] = []
    const events: AgentRuntimeEvent[] = []
    const runtime = createAgentRuntime(createDependencies(calls))
    runtime.subscribe((event) => events.push(event))

    runtime.questions.respond({
      requestId: 'question-1',
      answers: [{ questionId: 'q1', value: '后端' }],
    })

    expect(calls).toEqual(['question.respond'])
    expect(events).toContainEqual({
      sessionId: '',
      runId: 0,
      payload: {
        channel: 'host',
        event: { type: 'ask_user_resolved', requestId: 'question-1' },
      },
    })
  })
})
