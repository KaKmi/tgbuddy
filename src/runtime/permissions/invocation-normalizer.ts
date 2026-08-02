import type { ToolPolicyInput } from '../runs/agent-engine.ts'

export type InvocationTarget =
  | { kind: 'path'; value: string }
  | { kind: 'host'; value: string }
  | { kind: 'account'; value: string }
  | { kind: 'service'; value: string }

export interface ResolvedPathIdentity {
  kind: 'file' | 'directory' | 'missing'
  canonicalPath: string
  identityHash: string
  /** 缺失表示 resolver 无法证明目标位于工作区，分类器按越界处理。 */
  scope?: 'workspace' | 'outside'
}

export interface ResolvedShellInvocation {
  command: string
  dialect: 'auto' | 'bash' | 'cmd' | 'powershell'
  tokens: string[]
  compound: boolean
  redirected: boolean
  hasCommandSubstitution: boolean
  wrapper: boolean
  canonicalCwd: string
  workspaceId: string
  mountRevision: string
  executionEnvIdentityHash: string
}

export interface ResolvedMcpInvocation {
  serverId: string
  method: string
  permission: 'read' | 'write' | 'unknown'
}

export interface ResolvedExecutionContext {
  canonicalCwd: string
  workspaceId: string
  mountRevision: string
  identityHash: string
}

export interface ResolvedMcpMethodIdentity {
  permission: ResolvedMcpInvocation['permission']
  identityHash: string
}

export interface ResolvedInvocation {
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  kind: 'host_control' | 'file' | 'shell' | 'mcp' | 'network' | 'unknown'
  targets: InvocationTarget[]
  fingerprint: string
  resourceIdentityHash: string
  file?: {
    operation: 'read' | 'search' | 'write' | 'delete'
    paths: ResolvedPathIdentity[]
  }
  shell?: ResolvedShellInvocation
  mcp?: ResolvedMcpInvocation
}

export interface CompleteRiskEvidence {
  completeness: 'complete'
  policyVersion: string
  factors: string[]
  targets: InvocationTarget[]
  irreversible: boolean
  sensitive: boolean
  fingerprint: string
  resourceIdentityHash: string
}

export interface CompleteInvocation {
  status: 'complete'
  invocation: ResolvedInvocation
  evidence: CompleteRiskEvidence
}

export type InvocationNormalizationResult =
  | { status: 'incomplete'; reason: string; repairHint?: string }
  | CompleteInvocation

export interface InvocationNormalizer {
  normalize(input: ToolPolicyInput): Promise<InvocationNormalizationResult>
}

export interface InvocationNormalizerDependencies {
  resolvePath(path: string): Promise<ResolvedPathIdentity>
  policyVersion: string
  shellDialect?: ResolvedShellInvocation['dialect']
  /** Shell ticket 必须绑定真实 cwd、mount 与 ExecutionEnv；缺失时 normalization fail closed。 */
  resolveExecutionContext?(input: ToolPolicyInput): Promise<ResolvedExecutionContext>
  /** MCP 的 read/write 语义只能来自可信 descriptor，不能根据方法名前缀猜测。 */
  resolveMcpMethod?(
    serverId: string,
    method: string,
  ): Promise<ResolvedMcpMethodIdentity | undefined>
}

const HOST_CONTROL_TOOLS = new Set([
  'ask_user',
  'exit_plan_mode',
  'delegate_to_agent',
  'skill',
])
const READ_FILE_TOOLS = new Set(['read'])
const SEARCH_FILE_TOOLS = new Set(['glob', 'grep'])
const WRITE_FILE_TOOLS = new Set(['write', 'edit'])
const SHELL_WRAPPERS = new Set([
  'bash',
  'bun',
  'cmd',
  'deno',
  'node',
  'powershell',
  'pwsh',
  'python',
  'python2',
  'python3',
  'sh',
  'wsl',
  'zsh',
])

export function createInvocationNormalizer(
  dependencies: InvocationNormalizerDependencies,
): InvocationNormalizer {
  return {
    async normalize(input) {
      if (!input.toolName.trim()) {
        return { status: 'incomplete', reason: 'tool_name_required' }
      }

      if (READ_FILE_TOOLS.has(input.toolName)) {
        return normalizeFile(input, 'read', dependencies)
      }
      if (SEARCH_FILE_TOOLS.has(input.toolName)) {
        return normalizeFile(input, 'search', dependencies)
      }
      if (WRITE_FILE_TOOLS.has(input.toolName)) {
        return normalizeFile(input, 'write', dependencies)
      }
      if (input.toolName === 'delete') {
        return normalizeFile(input, 'delete', dependencies)
      }
      if (input.toolName === 'bash') {
        return normalizeShell(input, dependencies)
      }
      if (HOST_CONTROL_TOOLS.has(input.toolName)) {
        return complete(
          input,
          'host_control',
          [{ kind: 'service', value: `host:${input.toolName}` }],
          `host:${input.toolName}`,
          dependencies.policyVersion,
          ['host_control'],
        )
      }
      if (input.toolName.includes('.')) {
        return normalizeMcp(input, dependencies)
      }
      if (input.toolName === 'web_search') {
        return normalizeNetwork(input, dependencies.policyVersion)
      }

      return complete(
        input,
        'unknown',
        [{ kind: 'service', value: input.toolName }],
        `service:${input.toolName}`,
        dependencies.policyVersion,
        ['unknown_tool'],
      )
    },
  }
}

async function normalizeFile(
  input: ToolPolicyInput,
  operation: NonNullable<ResolvedInvocation['file']>['operation'],
  dependencies: InvocationNormalizerDependencies,
): Promise<InvocationNormalizationResult> {
  const rawPaths = filePaths(input, operation)
  if (rawPaths.length === 0) {
    return { status: 'incomplete', reason: 'path_required' }
  }

  let paths: ResolvedPathIdentity[]
  try {
    paths = await Promise.all(rawPaths.map((path) => dependencies.resolvePath(path)))
  } catch {
    return { status: 'incomplete', reason: 'path_resolution_failed' }
  }

  if (operation === 'read' && paths[0]?.kind === 'directory') {
    return {
      status: 'incomplete',
      reason: 'directory_requires_list',
      repairHint: '请改用 glob 或 list',
    }
  }
  if (operation === 'write' && paths.some((path) => path.kind === 'directory')) {
    return {
      status: 'incomplete',
      reason: 'directory_requires_file',
      repairHint: '请选择具体文件路径',
    }
  }

  const targets: InvocationTarget[] = paths.map((path) => ({
    kind: 'path',
    value: path.canonicalPath,
  }))
  const resourceIdentityHash = paths
    .map((path) => path.identityHash)
    .sort()
    .join('|')
  if (!resourceIdentityHash) {
    return { status: 'incomplete', reason: 'resource_identity_required' }
  }

  const factors = [
    `file:${operation}`,
    paths.every((path) => path.scope === 'workspace')
      ? 'workspace'
      : 'outside_or_unproven_workspace',
  ]
  return complete(
    input,
    'file',
    targets,
    resourceIdentityHash,
    dependencies.policyVersion,
    factors,
    { file: { operation, paths } },
  )
}

function filePaths(
  input: ToolPolicyInput,
  operation: NonNullable<ResolvedInvocation['file']>['operation'],
): string[] {
  if (operation === 'delete') {
    return Array.isArray(input.args.paths)
      ? input.args.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
      : []
  }
  if (operation === 'search') {
    const base = input.args.dir ?? input.args.path ?? '.'
    return typeof base === 'string' && base.length > 0 ? [base] : []
  }
  for (const key of ['path', 'file_path', 'filePath']) {
    const path = input.args[key]
    if (typeof path === 'string' && path.length > 0) return [path]
  }
  return []
}

async function normalizeShell(
  input: ToolPolicyInput,
  dependencies: InvocationNormalizerDependencies,
): Promise<InvocationNormalizationResult> {
  const command = input.args.command
  if (typeof command !== 'string' || !command.trim()) {
    return { status: 'incomplete', reason: 'command_required' }
  }
  const tokens = tokenizeShell(command)
  if (tokens.length === 0) {
    return { status: 'incomplete', reason: 'command_tokens_required' }
  }
  const first = shellExecutableName(tokens[0] ?? '')
  if (!dependencies.resolveExecutionContext) {
    return { status: 'incomplete', reason: 'execution_context_required' }
  }
  let context: ResolvedExecutionContext
  try {
    context = await dependencies.resolveExecutionContext(input)
  } catch {
    return { status: 'incomplete', reason: 'execution_context_resolution_failed' }
  }
  if (
    !context.canonicalCwd
    || !context.workspaceId
    || !context.mountRevision
    || !context.identityHash
  ) {
    return { status: 'incomplete', reason: 'execution_context_incomplete' }
  }
  const shell: ResolvedShellInvocation = {
    command,
    dialect: dependencies.shellDialect ?? 'auto',
    tokens,
    compound: tokens.some((token) => ['&&', '||', '|', ';'].includes(token)),
    redirected: tokens.some((token) => ['>', '>>', '<'].includes(token)),
    hasCommandSubstitution: command.includes('$(') || command.includes('`'),
    wrapper: SHELL_WRAPPERS.has(first),
    canonicalCwd: context.canonicalCwd,
    workspaceId: context.workspaceId,
    mountRevision: context.mountRevision,
    executionEnvIdentityHash: context.identityHash,
  }
  const hosts = extractHosts(command)
  const targets: InvocationTarget[] = [
    { kind: 'service', value: 'shell' },
    { kind: 'path', value: context.canonicalCwd },
    ...hosts.map((host): InvocationTarget => ({ kind: 'host', value: host })),
  ]
  return complete(
    input,
    'shell',
    targets,
    await sha256(`shell:${stableSerialize({
      command,
      dialect: shell.dialect,
      canonicalCwd: context.canonicalCwd,
      workspaceId: context.workspaceId,
      mountRevision: context.mountRevision,
      executionEnvIdentityHash: context.identityHash,
    })}`),
    dependencies.policyVersion,
    ['shell', ...(shell.compound ? ['compound'] : []), ...(shell.wrapper ? ['wrapper'] : [])],
    { shell },
  )
}

async function normalizeMcp(
  input: ToolPolicyInput,
  dependencies: InvocationNormalizerDependencies,
): Promise<InvocationNormalizationResult> {
  const separator = input.toolName.indexOf('.')
  const serverId = input.toolName.slice(0, separator)
  const method = input.toolName.slice(separator + 1)
  if (!serverId || !method) {
    return { status: 'incomplete', reason: 'mcp_identity_required' }
  }
  let methodIdentity: ResolvedMcpMethodIdentity | undefined
  try {
    methodIdentity = await dependencies.resolveMcpMethod?.(serverId, method)
  } catch {
    return { status: 'incomplete', reason: 'mcp_identity_resolution_failed' }
  }
  if (
    methodIdentity
    && (
      methodIdentity.identityHash.trim().length === 0
      || !['read', 'write', 'unknown'].includes(methodIdentity.permission)
    )
  ) {
    return { status: 'incomplete', reason: 'mcp_identity_required' }
  }
  const permission = methodIdentity?.permission ?? 'unknown'
  const targets: InvocationTarget[] = [{ kind: 'service', value: serverId }]
  if (typeof input.args.accountId === 'string' && input.args.accountId) {
    targets.push({ kind: 'account', value: input.args.accountId })
  }
  const originValues = ['url', 'origin', 'endpoint']
    .map((key) => input.args[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const originSet = new Set<string>()
  for (const originValue of originValues) {
    const resolved = extractHosts(originValue)
    if (resolved.length === 0) {
      return { status: 'incomplete', reason: 'mcp_origin_invalid' }
    }
    for (const origin of resolved) originSet.add(origin)
  }
  const origins = [...originSet].sort()
  targets.push(...origins.map((origin): InvocationTarget => ({ kind: 'host', value: origin })))
  const resourceIdentityHash = await sha256(stableSerialize({
    methodIdentityHash: methodIdentity?.identityHash ?? `${serverId}.${method}`,
    accountId: input.args.accountId,
    origins,
  }))
  return complete(
    input,
    'mcp',
    targets,
    resourceIdentityHash,
    dependencies.policyVersion,
    ['mcp', `method:${method}`, `permission:${permission}`],
    { mcp: { serverId, method, permission } },
  )
}

async function normalizeNetwork(
  input: ToolPolicyInput,
  policyVersion: string,
): Promise<InvocationNormalizationResult> {
  const url = typeof input.args.url === 'string' ? input.args.url : undefined
  const targets: InvocationTarget[] = url
    ? extractHosts(url).map((host) => ({ kind: 'host', value: host }))
    : [{ kind: 'service', value: 'web_search' }]
  return complete(
    input,
    'network',
    targets,
    await sha256(`network:${stableSerialize(targets)}`),
    policyVersion,
    ['controlled_network_read'],
  )
}

async function complete(
  input: ToolPolicyInput,
  kind: ResolvedInvocation['kind'],
  targets: InvocationTarget[],
  resourceIdentityHash: string,
  policyVersion: string,
  factors: string[],
  extra: Pick<ResolvedInvocation, 'file' | 'shell' | 'mcp'> = {},
): Promise<CompleteInvocation> {
  const fingerprint = await sha256(stableSerialize({
    toolName: input.toolName,
    args: input.args,
    targets,
    resourceIdentityHash,
  }))
  const invocation: ResolvedInvocation = {
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    args: input.args,
    kind,
    targets,
    fingerprint,
    resourceIdentityHash,
    ...(extra.file ? { file: extra.file } : {}),
    ...(extra.shell ? { shell: extra.shell } : {}),
    ...(extra.mcp ? { mcp: extra.mcp } : {}),
  }
  const sensitive = targets.some((target) =>
    target.kind === 'path' && /(?:^|[\\/])(?:\.ssh|\.env|credentials?|cookies?)(?:[\\/]|$)/i.test(target.value))
  return {
    status: 'complete',
    invocation,
    evidence: {
      completeness: 'complete',
      policyVersion,
      factors,
      targets,
      irreversible: kind === 'file' && extra.file?.operation === 'delete' && extra.file.paths.length >= 50,
      sensitive,
      fingerprint,
      resourceIdentityHash,
    },
  }
}

function tokenizeShell(command: string): string[] {
  return command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\$\(|&&|\|\||>>|[|;><`]|[^\s|;&><`]+/g) ?? []
}

function shellExecutableName(token: string): string {
  const unquoted = token.replace(/^["']+|["']+$/g, '').replaceAll('/', '\\')
  const basename = unquoted.split('\\').at(-1) ?? unquoted
  return basename.replace(/\.(?:com|cmd|exe)$/i, '').toLowerCase()
}

function extractHosts(value: string): string[] {
  const hosts = new Set<string>()
  for (const match of value.matchAll(/https?:\/\/[^\s"'|;&><]+/gi)) {
    try {
      const url = new URL(match[0])
      hosts.add(`${url.protocol}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`)
    } catch {
      // 无效 URL 不产生可授权 origin；Shell 仍由命令证据继续分级。
    }
  }
  return [...hosts].sort()
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
