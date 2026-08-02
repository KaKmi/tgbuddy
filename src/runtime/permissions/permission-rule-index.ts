import type {
  PermissionRule,
  RuleScope,
} from '../../shared/contracts/permission.ts'
import type { PermissionSubject } from '../../shared/contracts/run.ts'
import type { ResolvedInvocation } from './invocation-normalizer.ts'

export interface PermissionRuleSnapshot {
  revision: number
  rules: PermissionRule[]
}

export class PermissionRuleIndex {
  #snapshot: PermissionRuleSnapshot

  constructor(snapshot: PermissionRuleSnapshot) {
    this.#snapshot = structuredClone(snapshot)
  }

  current(): PermissionRuleSnapshot {
    return structuredClone(this.#snapshot)
  }

  replaceCommitted(snapshot: PermissionRuleSnapshot): void {
    if (snapshot.revision <= this.#snapshot.revision) {
      throw new Error('权限规则 revision 必须单调递增')
    }
    this.#snapshot = structuredClone(snapshot)
  }

  match(invocation: ResolvedInvocation, subject: PermissionSubject): PermissionRule | undefined {
    return this.#snapshot.rules.find((rule) =>
      rule.enabled !== false
      && ownerMatches(rule, subject)
      && invocationMatches(rule, invocation)
    )
  }
}

export function validateGrantOwner(
  subject: PermissionSubject,
  grant: { scope: RuleScope; ownerId?: string },
): void {
  if (subject.role !== 'root' && !['agent_run', 'delegation'].includes(grant.scope)) {
    throw new Error('子智能体只能创建 agent_run 或 delegation 范围规则')
  }
}

function ownerMatches(rule: PermissionRule, subject: PermissionSubject): boolean {
  if (rule.scope === 'agent_run') return rule.ownerId === subject.agentRunId
  if (rule.scope === 'delegation') return Boolean(subject.delegationId && rule.ownerId === subject.delegationId)
  if (rule.scope === 'session') return rule.ownerId === subject.rootSessionId
  return true
}

function invocationMatches(rule: PermissionRule, invocation: ResolvedInvocation): boolean {
  if (rule.tool !== invocation.toolName) return false
  if (rule.match === 'tool') return true
  if (rule.match === 'path') {
    return invocation.targets.some((target) =>
      target.kind === 'path' && target.value.startsWith(rule.pattern.replace(/\*+$/, ''))
    )
  }
  if (rule.match === 'command' || rule.match === 'prefix') {
    const expected = tokenize(rule.pattern)
    const actual = invocation.shell?.tokens.map((token) => token.toLowerCase()) ?? []
    return expected.every((token, index) => actual[index] === token)
  }
  if (rule.match === 'method') {
    return `${invocation.mcp?.serverId}.${invocation.mcp?.method}` === rule.pattern
  }
  const kind = rule.match === 'origin' ? 'host' : 'account'
  return invocation.targets.some((target) => target.kind === kind && target.value === rule.pattern)
}

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).map((token) => token.toLowerCase())
}
