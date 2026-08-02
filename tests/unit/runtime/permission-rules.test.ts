import { describe, expect, test } from 'bun:test'
import {
  createPermissionAskBroker,
  createPolicyEngine,
  MemoryPermissionRuleRepository,
  type PermissionAskBroker,
  PermissionRuleIndex,
  validateGrantOwner,
} from '../../../src/runtime/index.ts'
import type {
  PermissionRequest,
  PermissionRule,
  RuleScope,
} from '../../../src/shared/contracts/permission.ts'

interface GrantHarness {
  broker: PermissionAskBroker
  policy: ReturnType<typeof createPolicyEngine>
  repo: MemoryPermissionRuleRepository
  askCount(): number
  grant(
    toolName: string,
    args: Record<string, unknown>,
    grant: { match: PermissionRequest['suggestedGrants'][number]['match']; pattern: string; scope: RuleScope },
    sessionId?: string,
  ): Promise<void>
}

function createGrantHarness(
  workspaceId: (sessionId: string) => string | undefined = () => 'ws-1',
): GrantHarness {
  const repo = new MemoryPermissionRuleRepository()
  let sequence = 0
  const createId = (): string => `id-${++sequence}`
  const broker = createPermissionAskBroker({
    createId,
    emitRequest: () => {},
    applyGrant(request, grant) {
      repo.add({
        id: createId(),
        tool: request.toolName,
        match: grant.match,
        pattern: grant.pattern,
        scope: grant.scope,
        neverPersist: false,
        ownerId:
          grant.scope === 'session'
            ? request.sessionId
            : grant.scope === 'project'
              ? workspaceId(request.sessionId)
              : undefined,
        reason: '授权卡「总是允许」',
        source: 'user',
      })
    },
  })
  let askCalls = 0
  const policy = createPolicyEngine({
    rules: repo,
    getMode: () => 'auto',
    getWorkspaceId: workspaceId,
    ask: async (input, signal) => {
      askCalls++
      return broker.ask(input, signal)
    },
  })

  return {
    broker,
    policy,
    repo,
    askCount: () => askCalls,
    async grant(toolName, args, grant, sessionId = 'session-1') {
      const decision = policy.evaluate(
        { sessionId, toolCallId: 'tool-1', toolName, args },
        new AbortController().signal,
      )
      const pending = broker.pending()
      expect(pending).toHaveLength(1)
      broker.respond({
        requestId: pending[0]!.requestId,
        allowed: true,
        grant,
      })
      await expect(decision).resolves.toEqual({ action: 'allow' })
    },
  }
}

describe('MemoryPermissionRuleRepository', () => {
  test('command matcher 按 token 边界匹配，child 不能创建 project rule', () => {
    const rule: PermissionRule = {
      id: 'command-1',
      tool: 'bash',
      match: 'command',
      pattern: 'git status',
      scope: 'project',
      ownerId: 'ws-1',
      neverPersist: false,
      createdAt: 1,
      hits: 0,
    }
    const index = new PermissionRuleIndex({ revision: 1, rules: [rule] })
    const subject = {
      rootSessionId: 'session-1',
      executionSessionId: 'session-1',
      rootRunId: 'run-1',
      agentRunId: 'run-1',
      role: 'root' as const,
    }
    const invocation = (tokens: string[]) => ({
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: tokens.join(' ') },
      kind: 'shell' as const,
      targets: [{ kind: 'service' as const, value: 'shell' }],
      fingerprint: 'fp',
      resourceIdentityHash: 'resource',
      shell: {
        command: tokens.join(' '),
        dialect: 'auto' as const,
        tokens,
        compound: false,
        redirected: false,
        hasCommandSubstitution: false,
        wrapper: false,
        canonicalCwd: 'C:\\work',
        workspaceId: 'ws-1',
        mountRevision: 'mount-1',
        executionEnvIdentityHash: 'env-1',
      },
    })

    expect(index.match(invocation(['git', 'status', '--short']), subject)).toMatchObject({
      id: 'command-1',
    })
    expect(index.match(invocation(['git', 'statusx']), subject)).toBeUndefined()
    expect(() => validateGrantOwner(
      { ...subject, role: 'worker' },
      { scope: 'project', ownerId: 'ws-1' },
    )).toThrow('子智能体只能创建 agent_run 或 delegation 范围规则')
  })

  test('add 补齐 createdAt/hits，remove 按 id 删除', () => {
    const repo = new MemoryPermissionRuleRepository()
    repo.add({
      id: 'rule-1',
      tool: 'write',
      match: 'path',
      pattern: 'C:/work/**',
      scope: 'project',
      neverPersist: false,
      ownerId: 'ws-1',
    })
    repo.add({
      id: 'rule-2',
      tool: 'bash',
      match: 'prefix',
      pattern: 'git status',
      scope: 'global',
      neverPersist: false,
    })

    expect(repo.list()).toHaveLength(2)
    expect(repo.list()[0]).toMatchObject({
      id: 'rule-1',
      createdAt: expect.any(Number) as number,
      hits: 0,
    })

    repo.remove('rule-1')
    expect(repo.list().map((rule) => rule.id)).toEqual(['rule-2'])
    repo.remove('missing')
    expect(repo.list()).toHaveLength(1)
  })

  test('相同工具×范围×owner 重复添加只保留一条', () => {
    const repo = new MemoryPermissionRuleRepository()
    repo.add({
      id: 'rule-a',
      tool: 'write',
      match: 'path',
      pattern: 'C:/work/**',
      scope: 'project',
      neverPersist: false,
      ownerId: 'ws-1',
    })
    repo.add({
      id: 'rule-b',
      tool: 'write',
      match: 'path',
      pattern: 'C:/work/**',
      scope: 'project',
      neverPersist: false,
      ownerId: 'ws-1',
    })

    expect(repo.list()).toHaveLength(1)
    expect(repo.list()[0]?.id).toBe('rule-a')
  })
})

describe('「总是允许」规则闭环', () => {
  test('path glob 规则：放行目录后匹配调用自动允许，目录外仍询问', async () => {
    const harness = createGrantHarness()
    await harness.grant(
      'write',
      { path: 'C:\\work\\docs\\a.md' },
      { match: 'path', pattern: 'C:/work/docs/**', scope: 'project' },
    )

    const inDir = await harness.policy.evaluate(
      {
        sessionId: 'session-1',
        toolCallId: 'tool-2',
        toolName: 'write',
        args: { path: 'C:\\work\\docs\\b.md' },
      },
      new AbortController().signal,
    )
    expect(inDir).toEqual({ action: 'allow' })

    const outside = harness.policy.evaluate(
      {
        sessionId: 'session-1',
        toolCallId: 'tool-3',
        toolName: 'write',
        args: { path: 'C:\\work\\src\\b.ts' },
      },
      new AbortController().signal,
    )
    expect(harness.broker.pending()).toHaveLength(1)
    harness.broker.respond({
      requestId: harness.broker.pending()[0]!.requestId,
      allowed: false,
    })
    await expect(outside).resolves.toEqual({
      action: 'deny',
      reason: expect.stringContaining('拒绝'),
    })
    expect(harness.askCount()).toBe(2)
  })

  test('command prefix 规则：放行 git status 后同前缀命令自动允许', async () => {
    const harness = createGrantHarness()
    await harness.grant(
      'bash',
      { command: 'git status --short' },
      { match: 'prefix', pattern: 'git status', scope: 'global' },
    )

    const decision = await harness.policy.evaluate(
      {
        sessionId: 'session-1',
        toolCallId: 'tool-2',
        toolName: 'bash',
        args: { command: 'git status --branch' },
      },
      new AbortController().signal,
    )
    expect(decision).toEqual({ action: 'allow' })
    expect(harness.askCount()).toBe(1)
  })

  test('MCP method 规则：放行连接器方法后匹配调用自动允许', async () => {
    const harness = createGrantHarness()
    await harness.grant(
      'mcp__postgres',
      { method: 'select' },
      { match: 'method', pattern: 'mcp__postgres', scope: 'session' },
    )

    const decision = await harness.policy.evaluate(
      {
        sessionId: 'session-1',
        toolCallId: 'tool-2',
        toolName: 'mcp__postgres',
        args: { method: 'select' },
      },
      new AbortController().signal,
    )
    expect(decision).toEqual({ action: 'allow' })
    expect(harness.askCount()).toBe(1)
  })

  test('session 规则只作用于本会话；project 规则随工作区失效', async () => {
    const harness = createGrantHarness()
    await harness.grant(
      'write',
      { path: 'C:\\work\\a.md' },
      { match: 'tool', pattern: 'write', scope: 'session' },
      'session-1',
    )

    const otherSession = harness.policy.evaluate(
      {
        sessionId: 'session-2',
        toolCallId: 'tool-2',
        toolName: 'write',
        args: { path: 'C:\\work\\b.md' },
      },
      new AbortController().signal,
    )
    expect(harness.broker.pending()).toHaveLength(1)
    harness.broker.respond({
      requestId: harness.broker.pending()[0]!.requestId,
      allowed: false,
    })
    await expect(otherSession).resolves.toEqual({
      action: 'deny',
      reason: expect.stringContaining('拒绝'),
    })

    const otherWorkspace = createGrantHarness((sessionId) =>
      sessionId === 'session-9' ? 'ws-3' : 'ws-2',
    )
    await otherWorkspace.grant(
      'write',
      { path: 'C:\\work\\a.md' },
      { match: 'tool', pattern: 'write', scope: 'project' },
    )
    // 同一工作区的另一个会话仍命中 project 规则
    const sameWorkspace = await otherWorkspace.policy.evaluate(
      {
        sessionId: 'session-2',
        toolCallId: 'tool-2',
        toolName: 'write',
        args: { path: 'C:\\work\\same.md' },
      },
      new AbortController().signal,
    )
    expect(sameWorkspace).toEqual({ action: 'allow' })
    expect(otherWorkspace.askCount()).toBe(1)

    // 换工作区后 project 规则失效 → 重新询问
    const acrossWorkspace = otherWorkspace.policy.evaluate(
      {
        sessionId: 'session-9',
        toolCallId: 'tool-3',
        toolName: 'write',
        args: { path: 'C:\\work\\c.md' },
      },
      new AbortController().signal,
    )
    expect(otherWorkspace.broker.pending()).toHaveLength(1)
    otherWorkspace.broker.respond({
      requestId: otherWorkspace.broker.pending()[0]!.requestId,
      allowed: false,
    })
    await expect(acrossWorkspace).resolves.toEqual({
      action: 'deny',
      reason: expect.stringContaining('拒绝'),
    })
  })

  test('规则带 reason/source 记录来源', async () => {
    const harness = createGrantHarness()
    await harness.grant(
      'write',
      { path: 'C:\\work\\a.md' },
      { match: 'path', pattern: 'C:/work/**', scope: 'project' },
    )
    expect(harness.repo.list()[0]).toMatchObject({
      reason: '授权卡「总是允许」',
      source: 'user',
      ownerId: 'ws-1',
    })
  })
})
