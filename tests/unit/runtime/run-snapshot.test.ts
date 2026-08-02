import { describe, expect, test } from 'bun:test'
import type { AgentInvocation } from '../../../src/runtime/runs/agent-engine.ts'
import {
  buildCapabilitySnapshot,
  mergeUsageLedger,
} from '../../../src/runtime/runs/run-snapshot.ts'

function invocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    sessionId: 'session-1',
    text: 'hi',
    subject: {
      rootSessionId: 'session-1',
      executionSessionId: 'session-1',
      rootRunId: 'run-1',
      agentRunId: 'run-1',
      role: 'root',
    },
    permissionCeiling: {
      schemaVersion: 1,
      policyVersion: 'permission-v2',
      mode: 'auto',
      rootSessionId: 'session-1',
      workspaceId: 'ws-1',
      mountRevision: 'mount-1',
      allowedToolIds: ['read', 'pg.query'],
      maxAutoRisk: 'R3',
      role: 'root',
    },
    workspaceId: 'ws-1',
    cwd: 'C:\\work',
    channel: {
      id: 'ch-deepseek',
      name: 'DeepSeek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com',
      secretRef: 'secret_1',
      models: [
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          contextWindow: 1_000_000,
          maxTokens: 384_000,
        },
      ],
    },
    modelId: 'deepseek-v4-pro',
    systemPrompt: '你是助手',
    profile: {
      id: 'profile-1',
      name: '风险分析专家',
      channelId: 'ch-deepseek',
      modelId: 'deepseek-v4-pro',
    },
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
    skills: [
      {
        id: 'builtin:reg-check',
        name: 'reg-check',
        title: '监管口径核对',
        description: 'd',
        version: '1.0.0',
        source: 'builtin',
        root: 'C:\\skills',
        enabled: true,
      },
    ],
    ...overrides,
  }
}

describe('CapabilitySnapshot', () => {
  test('从不可变 invocation 构建快照：Profile/模型/工具/Skill/MCP 全部固化', () => {
    const snapshot = buildCapabilitySnapshot(invocation())
    expect(snapshot.profile?.name).toBe('风险分析专家')
    expect(snapshot.channel).toEqual({
      id: 'ch-deepseek',
      name: 'DeepSeek',
      modelId: 'deepseek-v4-pro',
    })
    expect(snapshot.tools.map((tool) => tool.id)).toEqual(['read', 'pg.query'])
    expect(snapshot.skills.map((skill) => skill.id)).toEqual([
      'builtin:reg-check',
    ])
    expect(snapshot.mcp).toEqual([
      { serverId: 'mcp-1', name: 'postgres', tools: ['pg.query'] },
    ])
    expect(snapshot.usage.totalTokens).toBe(0)
    expect(snapshot.permission).toEqual(invocation().permissionCeiling)
  })

  test('设置变更后重建快照不影响历史 snapshot（值对象）', () => {
    const first = buildCapabilitySnapshot(invocation())
    const second = buildCapabilitySnapshot(
      invocation({
        profile: {
          id: 'profile-1',
          name: '改名专家',
          channelId: 'ch-deepseek',
          modelId: 'deepseek-v4-flash',
        },
        modelId: 'deepseek-v4-flash',
      }),
    )
    expect(first.profile?.name).toBe('风险分析专家')
    expect(first.channel.modelId).toBe('deepseek-v4-pro')
    expect(second.profile?.name).toBe('改名专家')
  })

  test('分类 token 账本逐轮相加', () => {
    const ledger = mergeUsageLedger(
      mergeUsageLedger(
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 18,
          cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25, total: 3.75 },
        },
      ),
      {
        input: 3,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 5,
        cost: { input: 0.3, output: 0.8, cacheRead: 0, cacheWrite: 0, total: 1.1 },
      },
    )
    expect(ledger).toEqual({
      inputTokens: 13,
      outputTokens: 7,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalTokens: 23,
      costUsd: 4.85,
    })
  })

  test('失败 Run 也有已知账本（usage 归零而不是缺失）', () => {
    const snapshot = buildCapabilitySnapshot(invocation())
    expect(snapshot.usage).toBeDefined()
    expect(snapshot.usage.inputTokens).toBe(0)
  })
})
