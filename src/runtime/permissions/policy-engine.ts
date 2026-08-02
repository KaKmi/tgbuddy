import type {
  PermissionMode,
  PermissionRule,
} from '../../shared/contracts/permission.ts'
import { isReadLikeMcpMethod } from '../mcp/mcp-manager.ts'
import {
  isNeverPersist,
  isReadOnlyCommand,
  SYSTEM_TOOL_PATTERNS,
} from '../../shared/contracts/permission.ts'
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyInput,
} from '../runs/agent-engine.ts'
import type { PermissionRuleRepository } from './permission-rule-repository.ts'
import type { PlanEffectRepository } from '../plans/plan-effect-repository.ts'
import type { PlanEffectGrant } from '../../shared/contracts/permission.ts'
import type { PermissionRuleIndex } from './permission-rule-index.ts'
import type { InvocationNormalizer, ResolvedInvocation } from './invocation-normalizer.ts'
import type { PermissionRiskLevel, RiskClassifier } from './risk-classifier.ts'

/** 挂起授权请求所需的输入，从 ToolPolicyInput 收窄为 policy 域语义 */
export interface PermissionAskInput {
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  subject?: ToolPolicyInput['subject']
}

export interface PolicyEngineDependencies {
  rules: PermissionRuleRepository
  getMode(sessionId: string): PermissionMode
  /** project scope 规则的有效性需要会话所属工作区 */
  getWorkspaceId(sessionId: string): string | undefined
  /** ask 决策的落点：挂起等用户响应，返回是否放行及拒绝理由 */
  ask(
    input: PermissionAskInput,
    signal: AbortSignal,
  ): Promise<{ allowed: boolean; reason?: string; decisionId?: string }>
  /** Task 4 新决策链；短期可缺仅为旧测试/迁移入口。 */
  normalizer?: InvocationNormalizer
  classifier?: RiskClassifier
  planEffects?: PlanEffectRepository
  ruleIndex?: PermissionRuleIndex
}

const READONLY_TOOLS = new Set(['read', 'glob', 'grep', 'web_search', 'skill'])
// 计划模式已 skill 化：提交计划（exit_plan_mode）与提问（ask_user）都是
// 宿主只读能力，始终放行，不受权限模式与规则影响
const CONTROL_TOOLS = new Set(['exit_plan_mode', 'ask_user'])

export function isControlTool(toolName: string): boolean {
  return CONTROL_TOOLS.has(toolName)
}

function globMatch(pattern: string, path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  const expanded = pattern.replace(
    /^~/,
    process.env.HOME ?? process.env.USERPROFILE ?? '~',
  )
  const re = new RegExp(
    `^${expanded
      .replace(/\\/g, '/')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  )
  return re.test(normalized)
}

function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'file_path', 'filePath']) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function matchRule(
  rule: PermissionRule,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (rule.tool !== toolName) return false
  switch (rule.match) {
    case 'tool':
      return true
    case 'path': {
      const path = extractPath(args)
      return path !== undefined && globMatch(rule.pattern, path)
    }
    case 'prefix': {
      const command = typeof args.command === 'string' ? args.command : ''
      return command.startsWith(rule.pattern)
    }
    case 'method':
      return toolName === rule.pattern
    case 'command': {
      const command = typeof args.command === 'string' ? args.command : ''
      const expected = rule.pattern.trim().split(/\s+/)
      const actual = command.trim().split(/\s+/)
      return expected.every((token, index) => actual[index] === token)
    }
    case 'origin':
      return ['url', 'origin', 'endpoint'].some((key) => args[key] === rule.pattern)
    case 'account':
      return args.accountId === rule.pattern
  }
}

/** scope 决定规则有效期：session 只到会话结束，project 随工作区失效，global 常驻 */
function ruleIsValid(
  rule: PermissionRule,
  sessionId: string,
  workspaceId: string | undefined,
): boolean {
  switch (rule.scope) {
    // v2 的短生命周期规则必须结合稳定 subject 判断；Task 4/6 接入前 fail closed。
    case 'agent_run':
    case 'delegation':
      return false
    case 'session':
      return rule.ownerId === sessionId
    case 'project':
      return workspaceId !== undefined && rule.ownerId === workspaceId
    case 'global':
      return true
  }
}

function deny(reason: string): ToolPolicyDecision {
  return { action: 'deny', reason }
}

/**
 * 纯函数化的权限决策。规则、模式和会话归属都通过端口注入，
 * 本类不持有任何运行状态——挂起等用户响应的状态在 ask broker。
 */
export function createPolicyEngine(
  dependencies: PolicyEngineDependencies,
): ToolPolicy {
  return {
    async evaluate(input: ToolPolicyInput, signal: AbortSignal): Promise<ToolPolicyDecision> {
      if (dependencies.normalizer && dependencies.classifier) {
        return evaluateRiskPolicy(dependencies, input, signal)
      }
      const { sessionId, toolName, args } = input
      const mode = dependencies.getMode(sessionId)

      if (isControlTool(toolName)) return { action: 'allow' }
      if (mode === 'bypass') return { action: 'allow' }

      if (mode === 'plan') {
        if (READONLY_TOOLS.has(toolName)) return { action: 'allow' }
        // C11：MCP 方法名使用 server.method；只放行读类方法。
        if (
          toolName.includes('.')
          && !CONTROL_TOOLS.has(toolName)
          && isReadLikeMcpMethod(toolName)
        ) {
          return { action: 'allow' }
        }
        if (
          (toolName === 'write' || toolName === 'edit')
          && extractPath(args)?.endsWith('.md')
        ) {
          return { action: 'allow' }
        }
        if (toolName === 'bash' && isReadOnlyCommand(String(args.command ?? ''))) {
          return { action: 'allow' }
        }
        return deny('计划模式下不允许执行写操作，请先提交计划等待批准')
      }

      const command = typeof args.command === 'string' ? args.command : ''
      if (toolName === 'bash' && SYSTEM_TOOL_PATTERNS.some((re) => re.test(command))) {
        return deny('拒绝执行系统级工具：这类命令能绕过沙箱限制')
      }

      const neverPersist = isNeverPersist(toolName, args)
      if (neverPersist) {
        // 破坏性命令是硬约束：规则与模式都不能免除逐次确认
        const outcome = await dependencies.ask(
          {
            sessionId,
            toolCallId: input.toolCallId,
            toolName,
            args,
          },
          signal,
        )
        return outcome.allowed
          ? { action: 'allow' }
          : deny(outcome.reason ?? '用户拒绝了授权')
      }

      const workspaceId = dependencies.getWorkspaceId(sessionId)
      const hit = dependencies.rules
        .list()
        .find(
          (rule) =>
            ruleIsValid(rule, sessionId, workspaceId)
            && matchRule(rule, toolName, args),
        )
      if (hit) {
        return hit.action === 'deny'
          ? deny(`该工具已被规则禁止：${toolName}`)
          : { action: 'allow' }
      }

      // 内置分类兜底：只读工具直接放行，其余询问
      if (READONLY_TOOLS.has(toolName)) return { action: 'allow' }

      const outcome = await dependencies.ask(
        {
          sessionId,
          toolCallId: input.toolCallId,
          toolName,
          args,
        },
        signal,
      )
      return outcome.allowed
        ? { action: 'allow' }
        : deny(outcome.reason ?? '用户拒绝了授权')
    },
  }
}

async function evaluateRiskPolicy(
  dependencies: PolicyEngineDependencies & {
    normalizer?: InvocationNormalizer
    classifier?: RiskClassifier
  },
  input: ToolPolicyInput,
  signal: AbortSignal,
): Promise<ToolPolicyDecision> {
  const normalized = await dependencies.normalizer!.normalize(input)
  if (normalized.status === 'incomplete') {
    return {
      action: 'deny',
      reason: {
        kind: 'invalid_invocation',
        code: normalized.reason,
        ...(normalized.repairHint ? { repairHint: normalized.repairHint } : {}),
      },
    }
  }

  const ceiling = input.permissionCeiling
  if (ceiling && !ceiling.allowedToolIds.includes(input.toolName)) {
    return {
      action: 'deny',
      reason: { kind: 'permission', code: 'forbidden' },
    }
  }

  const workspaceId = dependencies.getWorkspaceId(input.sessionId)
  const rules = dependencies.ruleIndex?.current().rules ?? dependencies.rules.list()
  const hit = rules.find((rule) =>
    rule.enabled !== false
    && ruleIsValid(rule, input.sessionId, workspaceId)
    && matchRule(rule, input.toolName, input.args)
  )
  if (hit?.action === 'deny') {
    return {
      action: 'deny',
      reason: { kind: 'permission', code: 'denied' },
    }
  }

  const assessment = dependencies.classifier!.classify(normalized)
  if (assessment.status === 'forbidden') {
    return {
      action: 'deny',
      risk: 'R4',
      reason: { kind: 'permission', code: 'forbidden' },
    }
  }
  if (assessment.status === 'classification_error') {
    return {
      action: 'deny',
      reason: { kind: 'invalid_invocation', code: assessment.errorCode },
    }
  }

  const risk: PermissionRiskLevel = assessment.status === 'unknown_complete'
    ? assessment.effectiveRisk
    : assessment.level
  const invocation: ResolvedInvocation = normalized.invocation
  const mode = dependencies.getMode(input.sessionId)
  if (
    mode === 'plan'
    && input.toolName === 'delegate_to_agent'
    && input.args.role !== 'explorer'
    && !findPlanEffect(dependencies.planEffects, input, invocation, risk)
  ) {
    return {
      action: 'deny',
      risk,
      reason: { kind: 'plan_gate', code: 'plan_required' },
    }
  }
  if (risk === 'R0' || risk === 'R1') {
    return { action: 'allow', risk, invocation }
  }

  if (mode === 'plan') {
    const effect = findPlanEffect(dependencies.planEffects, input, invocation, risk)
    if (effect && risk !== 'R4') {
      return { action: 'authorize', risk, source: 'plan_effect', invocation }
    }
    return {
      action: 'deny',
      risk,
      reason: { kind: 'plan_gate', code: 'plan_required' },
    }
  }
  if (risk !== 'R4' && hit) {
    return { action: 'authorize', risk, source: 'rule', invocation }
  }
  if (risk !== 'R4' && mode === 'bypass') {
    return { action: 'authorize', risk, source: 'bypass', invocation }
  }

  const outcome = await dependencies.ask({
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    args: input.args,
    subject: input.subject,
  }, signal)
  return {
    action: 'approval_required',
    risk,
    allowed: outcome.allowed,
    invocation,
    ...(outcome.decisionId ? { decisionId: outcome.decisionId } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  }
}

function findPlanEffect(
  repository: PlanEffectRepository | undefined,
  input: ToolPolicyInput,
  invocation: ResolvedInvocation,
  risk: PermissionRiskLevel,
): PlanEffectGrant | undefined {
  const subject = input.subject
  if (!repository || !subject || risk === 'R4') return undefined
  return repository.list(subject.rootRunId).find((grant) => {
    if (grant.maxRisk === 'R2' && risk === 'R3') return false
    if (grant.subjectTemplate.kind === 'root_agent') {
      if (grant.subjectTemplate.agentRunId !== subject.agentRunId) return false
    } else if (grant.subjectTemplate.delegationIntentId !== input.args.delegationIntentId) {
      return false
    }
    if (grant.matcher.tool && grant.matcher.tool !== input.toolName) return false
    if (grant.matcher.match === 'tool') return grant.matcher.pattern === input.toolName
    if (grant.matcher.match === 'path') {
      return invocation.targets.some((target) =>
        target.kind === 'path' && planPathMatches(grant.matcher.pattern, target.value)
      )
    }
    if (grant.matcher.match === 'command') {
      return invocation.shell?.command.startsWith(grant.matcher.pattern) ?? false
    }
    if (grant.matcher.match === 'method') {
      return `${invocation.mcp?.serverId}.${invocation.mcp?.method}` === grant.matcher.pattern
    }
    const targetKind = grant.matcher.match === 'origin' ? 'host' : 'account'
    return invocation.targets.some((target) =>
      target.kind === targetKind && target.value === grant.matcher.pattern
    )
  })
}

function planPathMatches(pattern: string, actual: string): boolean {
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const expected = normalize(pattern)
  const received = normalize(actual)
  if (expected.endsWith('/**')) {
    const directory = expected.slice(0, -3)
    return received === directory || received.startsWith(`${directory}/`)
  }
  return received === expected
}
