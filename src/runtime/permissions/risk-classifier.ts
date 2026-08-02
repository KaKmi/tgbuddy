import type {
  CompleteInvocation,
  CompleteRiskEvidence,
  ResolvedInvocation,
} from './invocation-normalizer.ts'

export type PermissionRiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

export interface SuggestedGrant {
  match: 'tool' | 'path' | 'command' | 'method' | 'origin' | 'account'
  pattern: string
  label: string
}

export type RiskAssessment =
  | {
      status: 'classified'
      level: PermissionRiskLevel
      evidence: CompleteRiskEvidence
      suggestedGrants: SuggestedGrant[]
    }
  | {
      status: 'unknown_complete'
      effectiveRisk: 'R4'
      evidence: CompleteRiskEvidence
      reason: string
      suggestedGrants: []
    }
  | {
      status: 'forbidden'
      forbiddenReason: string
      evidence: CompleteRiskEvidence
      suggestedGrants: []
    }
  | { status: 'classification_error'; errorCode: string; suggestedGrants: [] }

export interface RiskClassifier {
  classify(input: CompleteInvocation): RiskAssessment
}

export interface RiskClassifierOptions {
  policyVersion: string
}

const HOST_CONTROL_TOOLS = new Set(['ask_user', 'exit_plan_mode', 'delegate_to_agent', 'skill'])

export function createRiskClassifier(options: RiskClassifierOptions): RiskClassifier {
  return {
    classify(input) {
      try {
        if (
          input.status !== 'complete'
          || input.evidence.completeness !== 'complete'
          || !input.evidence.fingerprint
          || !input.evidence.resourceIdentityHash
        ) {
          return classificationError('incomplete_evidence')
        }
        if (input.evidence.policyVersion !== options.policyVersion) {
          return classificationError('policy_version_mismatch')
        }
        return classifyComplete(input)
      } catch {
        return classificationError('classifier_exception')
      }
    },
  }
}

function classifyComplete(input: CompleteInvocation): RiskAssessment {
  const { invocation, evidence } = input
  const forbiddenReason = forbidden(invocation)
  if (forbiddenReason) {
    return { status: 'forbidden', forbiddenReason, evidence, suggestedGrants: [] }
  }

  if (HOST_CONTROL_TOOLS.has(invocation.toolName) || invocation.kind === 'host_control') {
    return classified('R0', evidence, [])
  }
  if (invocation.kind === 'file' && invocation.file) {
    return classifyFile(invocation, evidence)
  }
  if (invocation.kind === 'shell' && invocation.shell) {
    return classifyShell(invocation, evidence)
  }
  if (invocation.kind === 'mcp' && invocation.mcp) {
    if (invocation.mcp.permission === 'unknown') {
      return {
        status: 'unknown_complete',
        effectiveRisk: 'R4',
        evidence,
        reason: `MCP descriptor 未声明可信副作用：${invocation.mcp.serverId}.${invocation.mcp.method}`,
        suggestedGrants: [],
      }
    }
    const level: PermissionRiskLevel = invocation.mcp.permission === 'read' ? 'R1' : 'R3'
    return classified(level, evidence, level === 'R1' ? [] : [{
      match: 'method',
      pattern: `${invocation.mcp.serverId}.${invocation.mcp.method}`,
      label: `允许 ${invocation.mcp.serverId} 的 ${invocation.mcp.method}`,
    }])
  }
  if (invocation.kind === 'network') {
    return classified('R1', evidence, [])
  }

  return {
    status: 'unknown_complete',
    effectiveRisk: 'R4',
    evidence,
    reason: `权限规则包未覆盖完整调用：${invocation.toolName}`,
    suggestedGrants: [],
  }
}

function classifyFile(
  invocation: ResolvedInvocation,
  evidence: CompleteRiskEvidence,
): RiskAssessment {
  const file = invocation.file!
  const outside = file.paths.some((path) => path.scope !== 'workspace')
  const sensitive = evidence.sensitive
  if (sensitive) return classified('R4', { ...evidence, sensitive: true }, [])
  if (file.operation === 'delete' && (file.paths.length >= 50 || evidence.irreversible)) {
    return classified('R4', { ...evidence, irreversible: true }, [])
  }
  if (outside) {
    return classified('R3', evidence, pathGrants(file.paths))
  }
  if (file.operation === 'read' || file.operation === 'search') {
    return classified('R1', evidence, [])
  }
  return classified('R2', evidence, pathGrants(file.paths))
}

function classifyShell(
  invocation: ResolvedInvocation,
  evidence: CompleteRiskEvidence,
): RiskAssessment {
  const shell = invocation.shell!
  const command = shell.command.toLowerCase()
  if (
    /git\s+push\b[^\r\n]*(?:--force|-f\b)/i.test(command)
    || /(?:curl|wget)\b[^|]*(?:\||&&)\s*(?:sh|bash|zsh|pwsh|powershell)\b/i.test(command)
    || /\bfind\b[^\r\n]*\s-(?:delete|exec|execdir|ok|okdir)\b/i.test(command)
    || /\brm\b/i.test(command)
    || /\b(?:api[_-]?key|cookie|private[_-]?key|ssh[_-]?key|credential)\b/i.test(command)
  ) {
    return classified('R4', { ...evidence, irreversible: true }, [])
  }
  if (isStrictReadOnlyShell(shell)) {
    return classified('R1', evidence, [])
  }
  if (isWorkspaceBuildOrTest(shell.tokens)) {
    return classified('R2', evidence, commandGrant(shell.tokens))
  }
  if (shell.wrapper) {
    return classified('R4', evidence, [])
  }
  if (
    shell.compound
    || shell.redirected
    || shell.hasCommandSubstitution
    || shell.wrapper
    || /\b(?:curl|wget|npm|pnpm|yarn|pip|apt|brew|start|serve|install)\b/i.test(command)
  ) {
    return classified('R3', evidence, commandGrant(shell.tokens))
  }
  return classified('R3', evidence, commandGrant(shell.tokens))
}

function forbidden(invocation: ResolvedInvocation): string | undefined {
  if (invocation.toolName === 'rm_root') return '禁止删除系统根目标'
  if (invocation.kind !== 'shell' || !invocation.shell) return undefined
  const tokens = expandedShellTokens(invocation.shell.tokens)
  const commandHeads = shellCommandHeads(tokens)
  const semanticCommand = tokens.join(' ')
  const systemTools = new Set([
    'bcdedit', 'diskpart', 'format', 'mkfs', 'net', 'reg', 'sc', 'schtasks', 'vssadmin', 'wsl', 'wmic',
  ])
  if (tokens.includes('-encodedcommand')) {
    return '禁止执行无法检查内容的编码命令'
  }
  if (commandHeads.some((head) => systemTools.has(head))) {
    return '禁止执行可绕过工作区边界的系统工具'
  }
  if (
    commandHeads.some((head) => ['del', 'erase', 'rd', 'remove-item', 'rmdir', 'rm'].includes(head))
    && /(?:[a-z]:[\\/](?=\s|$)|[a-z]:[\\/]users[\\/]?(?=\s|$)|\/(?:home[\\/]?)?(?=\s|$))/i.test(semanticCommand)
  ) {
    return '禁止删除磁盘根目录或用户目录'
  }
  if (/\bdd\b[^\r\n]*\bof=\/dev\//i.test(semanticCommand)) {
    return '禁止直接覆写磁盘设备'
  }
  return undefined
}

function expandedShellTokens(tokens: string[]): string[] {
  return tokens.flatMap((token) => {
    const unquoted = token.replace(/^["'`]+|["'`]+$/g, '')
    return unquoted.split(/\s+/).filter(Boolean).map((part) => part.toLowerCase())
  })
}

function shellCommandHeads(tokens: string[]): string[] {
  const heads: string[] = []
  let expectHead = true
  for (const token of tokens) {
    if (['&&', '||', '|', ';', '&'].includes(token)) {
      expectHead = true
      continue
    }
    if (expectHead && ['{', '}'].includes(token)) continue
    if (expectHead) {
      heads.push(token)
      expectHead = token === 'sudo'
      continue
    }
    if (['-c', '-command', '-encodedcommand', '-lc', '/c'].includes(token)) {
      expectHead = true
    }
  }
  return heads
}

function isStrictReadOnlyShell(shell: NonNullable<ResolvedInvocation['shell']>): boolean {
  if (shell.compound || shell.redirected || shell.hasCommandSubstitution || shell.wrapper) return false
  const first = shell.tokens[0]?.toLowerCase() ?? ''
  if (first === 'git') {
    const subcommand = shell.tokens[1]?.toLowerCase() ?? ''
    const boundaryOverrides = new Set(['-c', '--git-dir', '--no-index', '--work-tree'])
    return ['branch', 'diff', 'log', 'show', 'status'].includes(subcommand)
      && !shell.tokens.some((token) => boundaryOverrides.has(token.toLowerCase()))
  }
  if (first === 'pwd') return shell.tokens.length === 1
  if (first === 'ls') {
    return shell.tokens.slice(1).every((token) => token === '.' || /^-[a-z0-9-]+$/i.test(token))
  }
  if (first === 'dir') {
    return shell.tokens.slice(1).every((token) => token === '.' || /^\/[a-z]+$/i.test(token))
  }
  return false
}

function isWorkspaceBuildOrTest(tokens: string[]): boolean {
  const first = tokens[0]?.toLowerCase() ?? ''
  const second = tokens[1]?.toLowerCase() ?? ''
  if (['bun', 'npm', 'pnpm', 'yarn'].includes(first)) {
    return second === 'test' || second === 'build' || (second === 'run' && ['test', 'build', 'typecheck'].includes(tokens[2]?.toLowerCase() ?? ''))
  }
  return first === 'tsc' || first === 'vitest' || first === 'jest'
}

function pathGrants(
  paths: NonNullable<ResolvedInvocation['file']>['paths'],
): SuggestedGrant[] {
  return paths.slice(0, 3).map((path) => ({
    match: 'path',
    pattern: path.canonicalPath,
    label: `允许此路径：${path.canonicalPath}`,
  }))
}

function commandGrant(tokens: string[]): SuggestedGrant[] {
  const prefix = tokens.slice(0, 2).join(' ')
  return prefix
    ? [{ match: 'command', pattern: prefix, label: `允许命令：${prefix}` }]
    : []
}

function classified(
  level: PermissionRiskLevel,
  evidence: CompleteRiskEvidence,
  suggestedGrants: SuggestedGrant[],
): RiskAssessment {
  return { status: 'classified', level, evidence, suggestedGrants }
}

function classificationError(errorCode: string): RiskAssessment {
  return { status: 'classification_error', errorCode, suggestedGrants: [] }
}
