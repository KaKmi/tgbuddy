import { describe, expect, test } from 'bun:test'
import type { ToolPolicyInput } from '../../../src/runtime/runs/agent-engine.ts'
import { createPlanAskBroker } from '../../../src/runtime/plans/plan-broker.ts'
import { MemoryPlanEffectRepository } from '../../../src/runtime/plans/plan-effect-repository.ts'
import { createPolicyEngine } from '../../../src/runtime/permissions/policy-engine.ts'
import { createInvocationNormalizer } from '../../../src/runtime/permissions/invocation-normalizer.ts'
import { MemoryPermissionRuleRepository } from '../../../src/runtime/permissions/permission-rule-repository.ts'
import { createRiskClassifier } from '../../../src/runtime/permissions/risk-classifier.ts'

function commandInput(command: string): ToolPolicyInput {
  return {
    sessionId: 'session-1',
    toolCallId: 'tool-1',
    toolName: 'bash',
    args: { command },
    subject: {
      rootSessionId: 'session-1',
      executionSessionId: 'session-1',
      rootRunId: 'root-1',
      agentRunId: 'agent-1',
      role: 'root',
    },
    permissionCeiling: {
      schemaVersion: 1,
      policyVersion: 'permission-v2',
      mode: 'auto',
      rootSessionId: 'session-1',
      workspaceId: 'workspace-1',
      mountRevision: 'mount-1',
      allowedToolIds: ['bash'],
      maxAutoRisk: 'R3',
      role: 'root',
    },
  }
}

describe('计划效果授权边界', () => {
  test('批准命令只精确匹配，不允许追加复合命令', async () => {
    const effects = new MemoryPlanEffectRepository()
    effects.add({
      rootRunId: 'root-1',
      planId: 'plan-1',
      planRevision: 1,
      effectId: 'effect-command',
      subjectTemplate: { kind: 'root_agent', agentRunId: 'agent-1' },
      maxRisk: 'R3',
      matcher: { tool: 'bash', match: 'command', pattern: 'npm test' },
    })
    const policy = createPolicyEngine({
      rules: new MemoryPermissionRuleRepository(),
      getMode: () => 'plan',
      getWorkspaceId: () => 'workspace-1',
      ask: async () => ({ allowed: true }),
      planEffects: effects,
      normalizer: createInvocationNormalizer({
        policyVersion: 'permission-v2',
        resolvePath: async (path) => ({
          kind: 'file', canonicalPath: path, identityHash: `path:${path}`, scope: 'workspace',
        }),
        resolveExecutionContext: async () => ({
          canonicalCwd: 'C:\\work',
          workspaceId: 'workspace-1',
          mountRevision: 'mount-1',
          identityHash: 'execution-1',
        }),
      }),
      classifier: createRiskClassifier({ policyVersion: 'permission-v2' }),
    })

    await expect(policy.evaluate(commandInput('npm test'), new AbortController().signal))
      .resolves.toMatchObject({ action: 'authorize', source: 'plan_effect' })
    await expect(policy.evaluate(
      commandInput('npm test && curl https://example.com'),
      new AbortController().signal,
    )).resolves.toMatchObject({
      action: 'deny', reason: { kind: 'plan_gate', code: 'plan_required' },
    })
  })

  test('提交新计划时立即撤销同一 root 的旧计划授权', async () => {
    const effects = new MemoryPlanEffectRepository()
    let sequence = 0
    const broker = createPlanAskBroker({
      createId: () => `plan-${++sequence}`,
      emitRequest: () => {},
      resolveSource: () => ({
        rootRunId: 'root-1', runId: 'agent-1', sessionId: 'session-1', subjectId: 'agent-1',
      }),
      revokeEffects: (source) => effects.removeRoot(source.rootRunId),
      commitEffects({ request, phase, source }) {
        request.effects.forEach((effect, index) => effects.add({
          rootRunId: source.rootRunId,
          planId: phase.planId,
          planRevision: phase.planRevision,
          effectId: `${phase.planId}:${index}`,
          subjectTemplate: { kind: 'root_agent', agentRunId: source.subjectId },
          maxRisk: effect.maxRisk,
          matcher: effect,
        }))
      },
    })
    const first = broker.requestApproval({
      sessionId: 'session-1',
      plan: '第一版计划',
      effects: [{ tool: 'write', match: 'path', pattern: 'C:\\work\\a.ts', maxRisk: 'R3' }],
    })
    broker.respond({ requestId: 'plan-1', approved: true })
    await first
    expect(effects.list('root-1')).toHaveLength(1)

    const second = broker.requestApproval({ sessionId: 'session-1', plan: '第二版计划' })
    expect(effects.list('root-1')).toEqual([])
    broker.respond({ requestId: 'plan-2', approved: false })
    await second
    expect(effects.list('root-1')).toEqual([])
  })
})
