import { describe, expect, test } from 'bun:test'
import { createInvocationNormalizer } from '../../../src/runtime/permissions/invocation-normalizer.ts'

describe('InvocationNormalizer', () => {
  test('目录 read 是可修复参数错误，不进入风险分类', async () => {
    const normalizer = createInvocationNormalizer({
      resolvePath: async () => ({
        kind: 'directory',
        canonicalPath: 'C:\\work\\docs',
        identityHash: 'dir-1',
      }),
      policyVersion: 'permission-v2',
    })

    expect(await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't',
      toolName: 'read',
      args: { path: 'docs' },
    })).toEqual({
      status: 'incomplete',
      reason: 'directory_requires_list',
      repairHint: '请改用 glob 或 list',
    })
  })

  test('文件目标完成 canonical identity，参数键顺序不影响 fingerprint', async () => {
    const normalizer = createInvocationNormalizer({
      resolvePath: async (path) => ({
        kind: 'file',
        canonicalPath: `C:\\work\\${path}`,
        identityHash: `file:${path}`,
        scope: 'workspace',
      }),
      policyVersion: 'permission-v2',
    })

    const first = await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't1',
      toolName: 'edit',
      args: { path: 'a.ts', oldText: 'a', newText: 'b' },
    })
    const second = await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't2',
      toolName: 'edit',
      args: { newText: 'b', oldText: 'a', path: 'a.ts' },
    })

    expect(first.status).toBe('complete')
    expect(second.status).toBe('complete')
    if (first.status !== 'complete' || second.status !== 'complete') return
    expect(first.invocation.targets).toEqual([{ kind: 'path', value: 'C:\\work\\a.ts' }])
    expect(first.evidence.resourceIdentityHash).toBe('file:a.ts')
    expect(first.evidence.fingerprint).toHaveLength(64)
    expect(first.evidence.fingerprint).not.toContain('oldText')
    expect(first.evidence.fingerprint).toBe(second.evidence.fingerprint)
  })

  test('Shell 形成 token vector，缺 command 时 fail closed', async () => {
    const normalizer = createInvocationNormalizer({
      resolvePath: async () => {
        throw new Error('不应解析路径')
      },
      policyVersion: 'permission-v2',
      resolveExecutionContext: async () => ({
        canonicalCwd: 'C:\\work',
        workspaceId: 'workspace-1',
        mountRevision: 'mount-1',
        identityHash: 'execution-env-1',
      }),
    })

    const complete = await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't',
      toolName: 'bash',
      args: { command: 'git status && curl https://example.com' },
    })
    expect(complete).toMatchObject({
      status: 'complete',
      invocation: {
        kind: 'shell',
        shell: {
          tokens: ['git', 'status', '&&', 'curl', 'https://example.com'],
          compound: true,
        },
      },
    })

    await expect(normalizer.normalize({
      sessionId: 's',
      toolCallId: 'missing',
      toolName: 'bash',
      args: {},
    })).resolves.toEqual({ status: 'incomplete', reason: 'command_required' })
  })

  test('Shell 必须绑定执行环境，环境变化会改变 resource identity 和 fingerprint', async () => {
    let revision = 'mount-1'
    const normalizer = createInvocationNormalizer({
      resolvePath: async () => {
        throw new Error('不应解析路径')
      },
      policyVersion: 'permission-v2',
      resolveExecutionContext: async () => ({
        canonicalCwd: 'C:\\work',
        workspaceId: 'workspace-1',
        mountRevision: revision,
        identityHash: `execution:${revision}`,
      }),
    })
    const input = {
      sessionId: 's',
      toolCallId: 't',
      toolName: 'bash',
      args: { command: 'git status' },
    }
    const first = await normalizer.normalize(input)
    revision = 'mount-2'
    const second = await normalizer.normalize(input)
    expect(first.status).toBe('complete')
    expect(second.status).toBe('complete')
    if (first.status !== 'complete' || second.status !== 'complete') return
    expect(first.invocation.shell).toMatchObject({
      canonicalCwd: 'C:\\work',
      workspaceId: 'workspace-1',
      mountRevision: 'mount-1',
      executionEnvIdentityHash: 'execution:mount-1',
    })
    expect(first.evidence.resourceIdentityHash).not.toBe(second.evidence.resourceIdentityHash)
    expect(first.evidence.fingerprint).not.toBe(second.evidence.fingerprint)

    const unbound = createInvocationNormalizer({
      resolvePath: async () => {
        throw new Error('不应解析路径')
      },
      policyVersion: 'permission-v2',
    })
    await expect(unbound.normalize(input)).resolves.toEqual({
      status: 'incomplete',
      reason: 'execution_context_required',
    })
  })

  test('MCP 调用绑定稳定 server/method，而不是展示名', async () => {
    const normalizer = createInvocationNormalizer({
      resolvePath: async () => {
        throw new Error('不应解析路径')
      },
      policyVersion: 'permission-v2',
      resolveMcpMethod: async (serverId, method) => ({
        permission: method === 'update_record' ? 'write' : 'unknown',
        identityHash: `mcp:${serverId}:${method}:v1`,
      }),
    })
    const result = await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't',
      toolName: 'postgres.update_record',
      args: { accountId: 'account-1', id: 7 },
    })

    expect(result).toMatchObject({
      status: 'complete',
      invocation: {
        kind: 'mcp',
        mcp: { serverId: 'postgres', method: 'update_record', permission: 'write' },
        targets: [
          { kind: 'service', value: 'postgres' },
          { kind: 'account', value: 'account-1' },
        ],
      },
    })
  })

  test('MCP origin 进入 target、resource identity 与 fingerprint', async () => {
    const normalizer = createInvocationNormalizer({
      resolvePath: async () => {
        throw new Error('不应解析路径')
      },
      policyVersion: 'permission-v2',
      resolveMcpMethod: async () => ({
        permission: 'read',
        identityHash: 'browser.fetch:v1',
      }),
    })
    const first = await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't1',
      toolName: 'browser.fetch',
      args: { url: 'http://169.254.169.254/latest/meta-data' },
    })
    const second = await normalizer.normalize({
      sessionId: 's',
      toolCallId: 't2',
      toolName: 'browser.fetch',
      args: { url: 'https://example.com/public' },
    })
    expect(first.status).toBe('complete')
    expect(second.status).toBe('complete')
    if (first.status !== 'complete' || second.status !== 'complete') return
    expect(first.invocation.targets).toContainEqual({
      kind: 'host',
      value: 'http://169.254.169.254:80',
    })
    expect(first.evidence.resourceIdentityHash).not.toBe(second.evidence.resourceIdentityHash)
    expect(first.evidence.fingerprint).not.toBe(second.evidence.fingerprint)
  })
})
