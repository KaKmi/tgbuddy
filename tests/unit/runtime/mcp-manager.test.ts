import { describe, expect, test } from 'bun:test'
import type {
  McpSaveInput,
  McpServerConfig,
} from '../../../src/shared/contracts/mcp.ts'
import type { SecretRef } from '../../../src/shared/contracts/secret.ts'
import { MemorySecretStore } from '../../../src/runtime/secrets/secret-store.ts'
import type { McpConfigRepository } from '../../../src/runtime/mcp/mcp-config-repository.ts'
import type {
  McpTransport,
  McpTransportFactory,
} from '../../../src/runtime/mcp/ports/mcp-transport.ts'
import {
  createMcpManager,
  type McpManager,
} from '../../../src/runtime/mcp/mcp-manager.ts'
import { createToolRegistry } from '../../../src/runtime/tools/tool-registry.ts'
import type { ToolRegistry } from '../../../src/runtime/tools/tool-registry.ts'

class MemoryMcpConfigRepository implements McpConfigRepository {
  readonly #configs = new Map<string, McpServerConfig>()

  list(): McpServerConfig[] {
    return [...this.#configs.values()]
  }

  get(serverId: string): McpServerConfig | undefined {
    return this.#configs.get(serverId)
  }

  save(config: McpServerConfig): McpServerConfig {
    this.#configs.set(config.id, config)
    return config
  }

  delete(serverId: string): void {
    this.#configs.delete(serverId)
  }
}

class FakeTransport implements McpTransport {
  readonly #behavior: 'ok' | 'fail' | 'hang'
  readonly #tools: Array<{ name: string; description?: string }>
  readonly #callBehavior: 'ok' | 'error' | 'hang' | 'isError'
  connected = false
  disconnected = false

  constructor(
    behavior: 'ok' | 'fail' | 'hang' = 'ok',
    tools: Array<{ name: string; description?: string }> = [],
    callBehavior: 'ok' | 'error' | 'hang' | 'isError' = 'ok',
  ) {
    this.#behavior = behavior
    this.#tools = tools
    this.#callBehavior = callBehavior
  }

  async connect(signal: AbortSignal): Promise<void> {
    if (this.#behavior === 'fail') {
      throw new Error('模拟连接失败')
    }
    if (this.#behavior === 'hang') {
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
      return
    }
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.disconnected = true
  }

  isConnected(): boolean {
    return this.connected
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    return this.#tools
  }

  async call(
    method: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ text: string; isError: boolean }> {
    if (this.#callBehavior === 'error') {
      throw new Error('MCP 调用失败')
    }
    if (this.#callBehavior === 'isError') {
      return { text: '服务端返回错误', isError: true }
    }
    if (this.#callBehavior === 'hang') {
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
      return { text: '', isError: false }
    }
    return { text: `${method}:${String(args.text ?? '')}`, isError: false }
  }
}

function createFixture(): {
  manager: McpManager
  transports: FakeTransport[]
  createdConfigs: McpServerConfig[]
  repository: MemoryMcpConfigRepository
  secrets: MemorySecretStore
  registry: ToolRegistry
  transportsByConfig: Map<string, FakeTransport>
} {
  const repository = new MemoryMcpConfigRepository()
  const transports: FakeTransport[] = []
  const createdConfigs: McpServerConfig[] = []
  const secrets = new MemorySecretStore()
  const registry = createToolRegistry({ descriptors: [] })
  const transportsByConfig = new Map<string, FakeTransport>()
  const factory: McpTransportFactory = {
    create(config) {
      createdConfigs.push(config)
      const tools =
        config.key === 'echo'
          ? [{ name: 'echo', description: '回显' }]
          : config.env?.TOOLS === 'none'
            ? []
            : [
                { name: 'query', description: '查询' },
                { name: 'exec', description: '执行写语句' },
              ]
      const behavior = config.env?.BEHAVIOR
      const transport = new FakeTransport(
        behavior === 'fail' ? 'fail' : behavior === 'hang' ? 'hang' : 'ok',
        tools,
        (config.env?.CALL === 'error'
          ? 'error'
          : config.env?.CALL === 'isError'
            ? 'isError'
            : config.env?.CALL === 'hang'
              ? 'hang'
              : 'ok') as 'ok' | 'error' | 'hang' | 'isError',
      )
      transportsByConfig.set(config.id, transport)
      transports.push(transport)
      return transport
    },
  }
  const manager = createMcpManager({
    repository,
    factory,
    secrets,
    createId: () => 'mcp-1',
    now: () => 1_000,
    connectTimeoutMs: 50,
    toolRegistry: registry,
  })
  return {
    manager,
    transports,
    createdConfigs,
    repository,
    secrets,
    registry,
    transportsByConfig,
  }
}

function serverInput(overrides: Partial<McpSaveInput> = {}): McpSaveInput {
  return {
    name: 'echo',
    transport: 'stdio',
    command: 'node scripts/mcp-fixture-server.mjs',
    enabled: true,
    ...overrides,
  }
}

describe('McpManager', () => {
  test('保存/列出/删除配置', () => {
    const { manager, repository } = createFixture()
    const saved = manager.save(serverInput())
    expect(saved.id).toBe('mcp-1')
    expect(manager.list()).toHaveLength(1)
    manager.delete('mcp-1')
    expect(repository.list()).toHaveLength(0)
  })

  test('连接成功：状态 connected，transport 收到解析后的环境变量', async () => {
    const { manager, transports, createdConfigs, secrets } = createFixture()
    const secretRef: SecretRef = 'secret_token'
    secrets.set(secretRef, 'sk-real-token')
    manager.save(
      serverInput({
        env: { TOKEN: `secret:${secretRef}`, PLAIN: 'abc' },
      }),
    )

    const status = await manager.connect('mcp-1')
    expect(status.state).toBe('connected')
    expect(transports[0]?.connected).toBe(true)
    expect(createdConfigs[0]?.env?.TOKEN).toBe('sk-real-token')
    expect(createdConfigs[0]?.env?.PLAIN).toBe('abc')
    const config = manager.list()[0]!
    expect(config.env?.TOKEN).toBe('secret:secret_token')
  })

  test('连接失败：状态 error 并带可操作信息，可重连恢复', async () => {
    const { manager, transports } = createFixture()
    manager.save(serverInput({ env: { BEHAVIOR: 'fail' } }))

    const failed = await manager.connect('mcp-1')
    expect(failed.state).toBe('error')
    expect(failed.error).toContain('模拟连接失败')
    expect(transports[0]?.disconnected).toBe(true)

    // 重连：去掉失败行为
    manager.save(serverInput({ id: 'mcp-1', env: {} }))
    const reconnected = await manager.connect('mcp-1')
    expect(reconnected.state).toBe('connected')
  })

  test('连接超时：状态 error 且提示超时', async () => {
    const { manager } = createFixture()
    manager.save(serverInput({ env: { BEHAVIOR: 'hang' } }))
    const status = await manager.connect('mcp-1')
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/超时/)
  })

  test('断开连接：状态回 off，transport 被清理', async () => {
    const { manager, transports } = createFixture()
    manager.save(serverInput())
    await manager.connect('mcp-1')
    await manager.disconnect('mcp-1')
    expect(manager.status('mcp-1').state).toBe('off')
    expect(transports[0]?.disconnected).toBe(true)
  })

  test('禁用中的服务拒绝连接并给出可操作提示', async () => {
    const { manager, transports } = createFixture()
    manager.save(serverInput({ enabled: false }))
    const status = await manager.connect('mcp-1')
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/启用/)
    expect(transports).toHaveLength(0)
  })

  test('保存已连接服务的新配置时旧连接被清理', async () => {
    const { manager, transports } = createFixture()
    manager.save(serverInput())
    await manager.connect('mcp-1')
    expect(transports[0]?.connected).toBe(true)

    manager.save(serverInput({ id: 'mcp-1', name: '改名' }))
    expect(transports[0]?.disconnected).toBe(true)
    expect(manager.status('mcp-1').state).toBe('off')
  })

  test('连接成功后发现的工具进入 ToolRegistry（server.method 命名）', async () => {
    const { manager, registry } = createFixture()
    manager.save(serverInput({ key: 'postgres' }))
    const status = await manager.connect('mcp-1')
    expect(status.state).toBe('connected')

    const tools = registry.list().filter((tool) => tool.category === 'mcp')
    expect(tools.map((tool) => tool.id)).toEqual([
      'postgres.query',
      'postgres.exec',
    ])
    expect(tools[0]?.source).toBe('echo')
  })

  test('重连后 schema 变化：旧工具移除、新工具注册，当前 Run 快照不变', async () => {
    const { manager, registry, transportsByConfig } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    await manager.connect('mcp-1')
    const frozen = registry.snapshot()
    expect(frozen.some((tool) => tool.id === 'pg.query')).toBe(true)

    // 断开后 schema 变化（TOOLS=none → 不再发现工具）
    manager.save(serverInput({ id: 'mcp-1', key: 'pg', env: { TOOLS: 'none' } }))
    await manager.connect('mcp-1')

    expect(registry.list().some((tool) => tool.id === 'pg.query')).toBe(false)
    // 已冻结快照仍是旧工具集合
    expect(frozen.some((tool) => tool.id === 'pg.query')).toBe(true)
  })

  test('断开后工具从注册表移除（只影响下一 Run）', async () => {
    const { manager, registry } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    await manager.connect('mcp-1')
    const frozen = registry.snapshot()

    await manager.disconnect('mcp-1')
    expect(registry.list().some((tool) => tool.id === 'pg.query')).toBe(false)
    expect(frozen.some((tool) => tool.id === 'pg.query')).toBe(true)
  })

  test('同名工具冲突：注册被拒绝并给出可操作错误', async () => {
    const { manager } = createFixture()
    manager.save(serverInput({ id: 'mcp-a', key: 'pg' }))
    manager.save(serverInput({ id: 'mcp-b', key: 'pg' }))
    await manager.connect('mcp-a')
    const status = await manager.connect('mcp-b')
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/冲突|重名/)
  })

  test('调用 MCP 工具：成功返回文本结果', async () => {
    const { manager } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    await manager.connect('mcp-1')

    const text = await manager.call('mcp-1', 'query', { text: 'x' })
    expect(text).toBe('query:x')
  })

  test('调用未连接服务抛出可诊断错误（断线不伪造成功）', async () => {
    const { manager } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    await expect(manager.call('mcp-1', 'query', {})).rejects.toThrow(/未连接/)
  })

  test('调用失败与结构化错误都抛到工具层', async () => {
    const errorFixture = createFixture()
    errorFixture.manager.save(
      serverInput({ key: 'pg', env: { CALL: 'error' } }),
    )
    await errorFixture.manager.connect('mcp-1')
    await expect(
      errorFixture.manager.call('mcp-1', 'query', {}),
    ).rejects.toThrow(/MCP 调用失败/)

    const isErrorFixture = createFixture()
    isErrorFixture.manager.save(
      serverInput({ key: 'pg', env: { CALL: 'isError' } }),
    )
    await isErrorFixture.manager.connect('mcp-1')
    await expect(
      isErrorFixture.manager.call('mcp-1', 'query', {}),
    ).rejects.toThrow(/服务端返回错误/)
  })

  test('调用超时可取消并映射为可操作错误', async () => {
    const { manager } = createFixture()
    manager.save(serverInput({ key: 'pg', env: { CALL: 'hang' } }))
    await manager.connect('mcp-1')
    await expect(
      manager.call('mcp-1', 'query', {}, AbortSignal.timeout(20)),
    ).rejects.toThrow(/超时|取消/)
  })

  test('同一服务并发 connect 共享在途结果，不产生双连接', async () => {
    const { manager, transports } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    const [first, second] = await Promise.all([
      manager.connect('mcp-1'),
      manager.connect('mcp-1'),
    ])
    expect(first.state).toBe('connected')
    expect(second.state).toBe('connected')
    expect(transports).toHaveLength(1)
  })

  test('连接失败后旧工具从注册表移除（服务不可用不留在下一 Run 快照）', async () => {
    const { manager, registry } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    await manager.connect('mcp-1')
    expect(registry.list().some((tool) => tool.id === 'pg.query')).toBe(true)

    manager.save(serverInput({ id: 'mcp-1', key: 'pg', env: { BEHAVIOR: 'fail' } }))
    const status = await manager.connect('mcp-1')
    expect(status.state).toBe('error')
    expect(registry.list().some((tool) => tool.id === 'pg.query')).toBe(false)
  })

  test('dispose 断开全部连接并清空 MCP 工具注册', async () => {
    const { manager, registry, transports } = createFixture()
    manager.save(serverInput({ key: 'pg' }))
    await manager.connect('mcp-1')
    expect(transports[0]?.connected).toBe(true)

    await manager.dispose()
    expect(transports[0]?.disconnected).toBe(true)
    expect(registry.list().some((tool) => tool.category === 'mcp')).toBe(false)
  })

  test('plan 模式读类 MCP 方法判定只看方法段（server 前缀不影响）', async () => {
    const { isReadLikeMcpMethod } = await import(
      '../../../src/runtime/mcp/mcp-manager.ts'
    )
    expect(isReadLikeMcpMethod('pg.query')).toBe(true)
    expect(isReadLikeMcpMethod('figma.get_file')).toBe(true)
    expect(isReadLikeMcpMethod('pg.exec')).toBe(false)
    expect(isReadLikeMcpMethod('slack.post')).toBe(false)
  })
})
