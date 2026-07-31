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
  connected = false
  disconnected = false

  constructor(behavior: 'ok' | 'fail' | 'hang' = 'ok') {
    this.#behavior = behavior
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
}

function createFixture(): {
  manager: McpManager
  transports: FakeTransport[]
  createdConfigs: McpServerConfig[]
  repository: MemoryMcpConfigRepository
  secrets: MemorySecretStore
} {
  const repository = new MemoryMcpConfigRepository()
  const transports: FakeTransport[] = []
  const createdConfigs: McpServerConfig[] = []
  const secrets = new MemorySecretStore()
  const factory: McpTransportFactory = {
    create(config) {
      createdConfigs.push(config)
      const behavior = config.env?.BEHAVIOR
      const transport = new FakeTransport(
        behavior === 'fail' ? 'fail' : behavior === 'hang' ? 'hang' : 'ok',
      )
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
  })
  return { manager, transports, createdConfigs, repository, secrets }
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
})
