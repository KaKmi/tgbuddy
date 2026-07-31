import { describe, expect, test } from 'bun:test'
import {
  createPolicyEngine,
  type PermissionAskInput,
} from '../../../src/runtime/permissions/policy-engine.ts'
import { MemoryPermissionRuleRepository } from '../../../src/runtime/permissions/permission-rule-repository.ts'
import type { PermissionRule } from '../../../src/shared/contracts/permission.ts'
import { isReadOnlyCommand } from '../../../src/shared/contracts/permission.ts'
import type { ToolPolicy, ToolPolicyInput } from '../../../src/runtime/runs/agent-engine.ts'

interface HarnessOptions {
  rules?: PermissionRule[]
  mode?: (sessionId: string) => 'plan' | 'auto' | 'bypass'
  workspaceId?: (sessionId: string) => string | undefined
  ask?: (input: PermissionAskInput, signal: AbortSignal) => Promise<boolean>
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
  })
  return { policy, askCalls, controller }
}

function tool(input: Partial<ToolPolicyInput> = {}): ToolPolicyInput {
  return {
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    toolName: 'write',
    args: { path: 'C:\\work\\a.md' },
    ...input,
  }
}

describe('PolicyEngine 基础决策', () => {
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
