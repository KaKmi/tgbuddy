import { describe, expect, test } from 'bun:test'
import {
  createPolicyEngine,
  type PermissionAskInput,
} from '../../../src/runtime/permissions/policy-engine.ts'
import { MemoryPermissionRuleRepository } from '../../../src/runtime/permissions/permission-rule-repository.ts'
import type { PermissionRule } from '../../../src/shared/contracts/permission.ts'
import { isReadOnlyCommand } from '../../../src/shared/contracts/permission.ts'
import type { ToolPolicy, ToolPolicyInput } from '../../../src/runtime/runs/agent-engine.ts'
import { createInvocationNormalizer } from '../../../src/runtime/permissions/invocation-normalizer.ts'
import { createRiskClassifier } from '../../../src/runtime/permissions/risk-classifier.ts'
import { MemoryPlanEffectRepository } from '../../../src/runtime/plans/plan-effect-repository.ts'

interface HarnessOptions {
  rules?: PermissionRule[]
  mode?: (sessionId: string) => 'plan' | 'auto' | 'bypass'
  workspaceId?: (sessionId: string) => string | undefined
  ask?: (input: PermissionAskInput, signal: AbortSignal) => Promise<boolean>
  riskPolicy?: boolean
  planEffects?: MemoryPlanEffectRepository
}

function harness(options: HarnessOptions = {}): {
  policy: ToolPolicy
  askCalls: Array<{ input: PermissionAskInput; signal: AbortSignal }>
  controller: AbortController
} {
  const askCalls: Array<{ input: PermissionAskInput; signal: AbortSignal }> = []
  const controller = new AbortController()
  const policy = createPolicyEngine({
    rules: new MemoryPermissionRuleRepository(options.rules ?? []),
    getMode: options.mode ?? (() => 'auto'),
    getWorkspaceId: options.workspaceId ?? (() => 'ws-1'),
    ask: async (input, signal) => {
      askCalls.push({ input, signal })
      const outcome = options.ask
        ? options.ask(input, signal)
        : { allowed: true }
      return typeof outcome === 'boolean'
        ? { allowed: outcome }
        : outcome
    },
    planEffects: options.planEffects,
    ...(options.riskPolicy
      ? {
          normalizer: createInvocationNormalizer({
            policyVersion: 'permission-v2',
            resolvePath: async (path) => ({
              kind: 'file',
              canonicalPath: path,
              identityHash: `path:${path}`,
              scope: path.startsWith('C:\\work') ? 'workspace' : 'outside',
            }),
            resolveExecutionContext: async () => ({
              canonicalCwd: 'C:\\work',
              workspaceId: 'ws-1',
              mountRevision: 'mount-1',
              identityHash: 'execution-1',
            }),
          }),
          classifier: createRiskClassifier({ policyVersion: 'permission-v2' }),
        }
      : {}),
  })
  return { policy, askCalls, controller }
}

function tool(input: Partial<ToolPolicyInput> = {}): ToolPolicyInput {
  return {
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    toolName: 'write',
    args: { path: 'C:\\work\\a.md' },
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
      allowedToolIds: ['read', 'write', 'edit', 'bash', 'ask_user', 'delegate_to_agent'],
      maxAutoRisk: 'R3',
      role: 'root',
    },
    ...input,
  }
}

describe('PolicyEngine 基础决策', () => {
  test('bypass 只自动授权 R0-R3，R4 仍询问，F 直接拒绝', async () => {
    const h = harness({ mode: () => 'bypass', riskPolicy: true })
    await expect(h.policy.evaluate(tool({
      toolName: 'bash',
      args: { command: 'curl https://example.com' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'authorize',
      risk: 'R3',
      source: 'bypass',
    })
    await expect(h.policy.evaluate(tool({
      toolName: 'bash',
      args: { command: 'git push --force' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'approval_required',
      risk: 'R4',
      allowed: true,
    })
    await expect(h.policy.evaluate(tool({
      toolName: 'bash',
      args: { command: 'rm -rf C:\\Users' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'deny',
      reason: { kind: 'permission', code: 'forbidden' },
    })
    expect(h.askCalls).toHaveLength(1)
  })

  test('planning 只允许只读能力与 Explorer，Worker 和写 effect 返回 plan gate', async () => {
    const h = harness({ mode: () => 'plan', riskPolicy: true })
    await expect(h.policy.evaluate(tool({
      toolName: 'bash',
      args: { command: 'git status' },
    }), h.controller.signal)).resolves.toMatchObject({ action: 'allow', risk: 'R1' })
    await expect(h.policy.evaluate(tool({
      toolName: 'delegate_to_agent',
      args: { task: '调查', role: 'explorer' },
    }), h.controller.signal)).resolves.toMatchObject({ action: 'allow', risk: 'R0' })
    await expect(h.policy.evaluate(tool({
      toolName: 'delegate_to_agent',
      args: { task: '实现', role: 'worker', delegationIntentId: 'intent-1' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'deny',
      reason: { kind: 'plan_gate', code: 'plan_required' },
    })
    await expect(h.policy.evaluate(tool({
      toolName: 'write',
      args: { path: 'C:\\work\\src\\a.ts' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'deny',
      reason: { kind: 'plan_gate', code: 'plan_required' },
    })
    expect(h.askCalls).toHaveLength(0)
  })

  test('计划批准只放行当前 Agent 的精确路径，不扩大到相邻前缀', async () => {
    const effects = new MemoryPlanEffectRepository()
    effects.add({
      rootRunId: 'run-1',
      planId: 'plan-1',
      planRevision: 1,
      effectId: 'effect-1',
      subjectTemplate: { kind: 'root_agent', agentRunId: 'run-1' },
      maxRisk: 'R3',
      matcher: { tool: 'write', match: 'path', pattern: 'C:\\work\\src\\a.ts' },
    })
    const h = harness({ mode: () => 'plan', riskPolicy: true, planEffects: effects })

    await expect(h.policy.evaluate(tool({
      args: { path: 'C:\\work\\src\\a.ts' },
    }), h.controller.signal)).resolves.toMatchObject({ action: 'authorize', source: 'plan_effect' })
    await expect(h.policy.evaluate(tool({
      args: { path: 'C:\\work\\src\\a.ts.bak' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'deny', reason: { kind: 'plan_gate', code: 'plan_required' },
    })
    await expect(h.policy.evaluate(tool({
      subject: { ...tool().subject!, agentRunId: 'run-2' },
      args: { path: 'C:\\work\\src\\a.ts' },
    }), h.controller.signal)).resolves.toMatchObject({
      action: 'deny', reason: { kind: 'plan_gate', code: 'plan_required' },
    })
  })

  test('默认读工具 allow，不触发 broker', async () => {
    const { policy, askCalls } = harness()
    expect(await policy.evaluate(tool({ toolName: 'read', args: { path: 'C:\\work\\a.ts' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(0)
  })

  test('默认写工具 ask：允许后放行，拒绝后 deny', async () => {
    const allowHarness = harness()
    expect(await allowHarness.policy.evaluate(tool(), allowHarness.controller.signal))
      .toEqual({ action: 'allow' })
    expect(allowHarness.askCalls).toHaveLength(1)
    expect(allowHarness.askCalls[0]?.input).toMatchObject({
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'write',
    })

    const denyHarness = harness({ ask: async () => ({ allowed: false, reason: '用户不想执行' }) })
    expect(await denyHarness.policy.evaluate(tool(), denyHarness.controller.signal))
      .toEqual({ action: 'deny', reason: '用户不想执行' })
  })

  test('bash 命令默认询问；ask_user 等控制工具直接 allow', async () => {
    const { policy, askCalls } = harness()
    expect(await policy.evaluate(tool({ toolName: 'bash', args: { command: 'ls' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(1)

    expect(await policy.evaluate(tool({ toolName: 'ask_user', args: {} }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(1)
  })

  test('bypass 模式全放行，不询问', async () => {
    const { policy, askCalls } = harness({ mode: () => 'bypass' })
    expect(await policy.evaluate(tool({ toolName: 'bash', args: { command: 'rm -rf x' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(0)
  })

  test('plan 模式：读放行、.md 写入放行、只读命令放行、其余写操作拒绝', async () => {
    const { policy, askCalls } = harness({ mode: () => 'plan' })
    expect(await policy.evaluate(tool({ toolName: 'read', args: { path: 'C:\\work\\a.ts' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ toolName: 'write', args: { path: 'C:\\work\\plan.md' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ toolName: 'bash', args: { command: 'git status' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ toolName: 'write', args: { path: 'C:\\work\\app.ts' } }), new AbortController().signal))
      .toEqual({ action: 'deny', reason: expect.stringContaining('计划模式') })
    expect(askCalls).toHaveLength(0)
  })

  test('isReadOnlyCommand：find 的破坏性子命令不算只读', () => {
    expect(isReadOnlyCommand('find . -delete')).toBe(false)
    expect(isReadOnlyCommand('find . -name "*.tmp" -exec rm {} +')).toBe(false)
    expect(isReadOnlyCommand('find . -name "*.tmp" -execdir rm {} +')).toBe(false)
    expect(isReadOnlyCommand('find . -name "*.ts"')).toBe(true)
    expect(isReadOnlyCommand('ls -la')).toBe(true)
  })

  test('plan 模式：find -delete / -exec 不得绕过计划审批，普通 find 仍放行', async () => {
    const { policy, askCalls } = harness({ mode: () => 'plan' })
    expect(
      await policy.evaluate(
        tool({ toolName: 'bash', args: { command: 'find . -delete' } }),
        new AbortController().signal,
      ),
    ).toEqual({ action: 'deny', reason: expect.stringContaining('计划模式') })
    expect(
      await policy.evaluate(
        tool({ toolName: 'bash', args: { command: 'find . -name "*.tmp" -exec rm {} +' } }),
        new AbortController().signal,
      ),
    ).toEqual({ action: 'deny', reason: expect.stringContaining('计划模式') })
    expect(
      await policy.evaluate(
        tool({ toolName: 'bash', args: { command: 'find . -name "*.ts"' } }),
        new AbortController().signal,
      ),
    ).toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(0)
  })

  test('破坏性命令是硬约束：规则与模式都不能免除逐次确认', async () => {
    const neverPersistPolicy = harness()
    expect(
      await neverPersistPolicy.policy.evaluate(
        tool({ toolName: 'bash', args: { command: 'rm -rf tmp/cache' } }),
        neverPersistPolicy.controller.signal,
      ),
    ).toEqual({ action: 'allow' })
    expect(neverPersistPolicy.askCalls).toHaveLength(1)
  })

  test('tool 匹配的 allow 规则直接放行，deny 规则直接拒绝，都不询问', async () => {
    const rules: PermissionRule[] = [
      {
        id: 'rule-allow',
        tool: 'write',
        match: 'tool',
        pattern: 'write',
        scope: 'global',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
        action: 'allow',
      },
      {
        id: 'rule-deny',
        tool: 'edit',
        match: 'tool',
        pattern: 'edit',
        scope: 'global',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
        action: 'deny',
      },
    ]
    const { policy, askCalls } = harness({ rules })
    expect(await policy.evaluate(tool(), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ toolName: 'edit' }), new AbortController().signal))
      .toEqual({ action: 'deny', reason: expect.any(String) })
    expect(askCalls).toHaveLength(0)
  })

  test('path 规则按 glob 匹配，prefix 规则匹配命令前缀，method 规则匹配工具名', async () => {
    const rules: PermissionRule[] = [
      {
        id: 'rule-path',
        tool: 'write',
        match: 'path',
        pattern: 'C:/work/docs/**',
        scope: 'global',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
      },
      {
        id: 'rule-prefix',
        tool: 'bash',
        match: 'prefix',
        pattern: 'git status',
        scope: 'global',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
      },
      {
        id: 'rule-method',
        tool: 'mcp__db',
        match: 'method',
        pattern: 'mcp__db',
        scope: 'global',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
      },
    ]
    const { policy, askCalls } = harness({ rules })
    expect(await policy.evaluate(tool({ args: { path: 'C:\\work\\docs\\b.md' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ args: { path: 'C:\\work\\src\\b.ts' } }), new AbortController().signal))
      .toEqual({ action: 'allow' }) // 不匹配 path 规则 → ask，broker 默认放行
    expect(await policy.evaluate(tool({ toolName: 'bash', args: { command: 'git status --short' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ toolName: 'mcp__db', args: { method: 'select' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(1)
  })

  test('scope 有效期：session 规则只匹配本会话，project 规则匹配当前工作区，global 常匹配', async () => {
    const rules: PermissionRule[] = [
      {
        id: 'rule-session',
        tool: 'write',
        match: 'tool',
        pattern: 'write',
        scope: 'session',
        ownerId: 'session-1',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
      },
      {
        id: 'rule-project',
        tool: 'edit',
        match: 'tool',
        pattern: 'edit',
        scope: 'project',
        ownerId: 'ws-1',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
      },
    ]
    const { policy, askCalls } = harness({ rules })
    expect(await policy.evaluate(tool(), new AbortController().signal)).toEqual({ action: 'allow' })
    expect(await policy.evaluate(tool({ sessionId: 'session-2' }), new AbortController().signal)).toEqual({ action: 'allow' }) // session 规则过期 → ask，默认放行
    expect(await policy.evaluate(tool({ toolName: 'edit' }), new AbortController().signal)).toEqual({ action: 'allow' })
    // project 规则按工作区归属，跨会话同工作区仍命中
    expect(await policy.evaluate(tool({ toolName: 'edit', sessionId: 'session-2' }), new AbortController().signal)).toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(1)

    const otherWs = harness({ rules, workspaceId: () => 'ws-2' })
    expect(await otherWs.policy.evaluate(tool({ toolName: 'edit' }), otherWs.controller.signal)).toEqual({ action: 'allow' }) // project 规则失效 → ask
    expect(otherWs.askCalls).toHaveLength(1)
  })

  test('neverPersist 操作跳过规则直接询问', async () => {
    const rules: PermissionRule[] = [
      {
        id: 'rule-bash',
        tool: 'bash',
        match: 'tool',
        pattern: 'bash',
        scope: 'global',
        neverPersist: false,
        createdAt: 1,
        hits: 0,
      },
    ]
    const { policy, askCalls } = harness({ rules })
    expect(await policy.evaluate(tool({ toolName: 'bash', args: { command: 'rm -rf x' } }), new AbortController().signal))
      .toEqual({ action: 'allow' })
    expect(askCalls).toHaveLength(1)
  })

  test('系统级命令默认 deny，不询问', async () => {
    const { policy, askCalls } = harness()
    expect(await policy.evaluate(tool({ toolName: 'bash', args: { command: 'reg add HKCU' } }), new AbortController().signal))
      .toEqual({ action: 'deny', reason: expect.any(String) })
    expect(askCalls).toHaveLength(0)
  })

  test('broker 收到 AbortSignal 透传', async () => {
    const { policy, askCalls, controller } = harness()
    await policy.evaluate(tool(), controller.signal)
    expect(askCalls[0]?.signal).toBe(controller.signal)
  })
})
