import type {
  McpSaveInput,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
} from '../../shared/contracts/mcp.ts'
import type { SecretStore } from '../secrets/secret-store.ts'
import type { McpConfigRepository } from './mcp-config-repository.ts'
import type {
  McpTransport,
  McpTransportFactory,
} from './ports/mcp-transport.ts'

export interface CreateMcpManagerOptions {
  repository: McpConfigRepository
  factory: McpTransportFactory
  secrets: SecretStore
  createId(): string
  now(): number
  connectTimeoutMs?: number
}

export interface McpManager {
  list(): McpServerConfig[]
  save(input: McpSaveInput): McpServerConfig
  delete(serverId: string): void
  connect(serverId: string, signal?: AbortSignal): Promise<McpServerStatus>
  disconnect(serverId: string): Promise<void>
  status(serverId: string): McpServerStatus
  statuses(): McpServerStatus[]
}

interface ConnectionState {
  transport?: McpTransport
  state: McpServerState
  error?: string
  lastConnectedAt?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const SECRET_PREFIX = 'secret:'

/**
 * MCP 连接管理器：Runtime 持有连接状态，传输实现由 factory 注入。
 * 环境变量的 `secret:<ref>` 在连接时替换为明文，配置本身不落明文。
 */
export function createMcpManager(
  options: CreateMcpManagerOptions,
): McpManager {
  const states = new Map<string, ConnectionState>()
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS

  const toStatus = (serverId: string, state: ConnectionState): McpServerStatus => ({
    serverId,
    state: state.state,
    ...(state.error ? { error: state.error } : {}),
    ...(state.lastConnectedAt ? { lastConnectedAt: state.lastConnectedAt } : {}),
  })

  const dropConnection = (serverId: string): void => {
    const state = states.get(serverId)
    if (state?.transport) {
      void state.transport.disconnect().catch((error: unknown) => {
        console.error(`[mcp] ${serverId} 断开失败（忽略）：`, error)
      })
    }
    states.delete(serverId)
  }

  const statusOf = (serverId: string): McpServerStatus => {
    const state = states.get(serverId)
    return state
      ? toStatus(serverId, state)
      : { serverId, state: 'off' }
  }

  return {
    list: () => options.repository.list(),
    save(input) {
      const now = options.now()
      const existing = input.id ? options.repository.get(input.id) : undefined
      const config: McpServerConfig = {
        id: input.id ?? options.createId(),
        name: input.name,
        transport: input.transport,
        ...(input.command ? { command: input.command } : {}),
        ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.env && Object.keys(input.env).length > 0
          ? { env: input.env }
          : {}),
        enabled: input.enabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      options.repository.save(config)
      // 配置变更后旧连接不可信：断开并回到 off，等待显式重连。
      dropConnection(config.id)
      return config
    },
    delete(serverId) {
      dropConnection(serverId)
      options.repository.delete(serverId)
    },
    async connect(serverId, signal) {
      const config = options.repository.get(serverId)
      if (!config) {
        return { serverId, state: 'error', error: `MCP 服务不存在：${serverId}` }
      }
      const existing = states.get(serverId)
      if (existing?.state === 'connected') return toStatus(serverId, existing)
      if (!config.enabled) {
        return {
          serverId,
          state: 'error',
          error: '该 MCP 服务已禁用，请先在设置中启用再连接',
        }
      }
      if (existing?.transport) {
        await existing.transport.disconnect().catch(() => {})
        states.delete(serverId)
      }

      const state: ConnectionState = { state: 'connecting' }
      states.set(serverId, state)
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new DOMException('连接超时', 'TimeoutError'))
      }, timeoutMs)
      const onExternalAbort = (): void => controller.abort(signal?.reason)
      if (signal?.aborted) controller.abort(signal.reason)
      else signal?.addEventListener('abort', onExternalAbort)

      let transport: McpTransport
      try {
        const resolvedConfig = {
          ...config,
          env: resolveSecretEnv(config.env, options.secrets),
        }
        transport = options.factory.create(resolvedConfig)
        state.transport = transport
        await transport.connect(controller.signal)
        state.state = 'connected'
        state.lastConnectedAt = options.now()
        return toStatus(serverId, state)
      } catch (error) {
        state.state = 'error'
        state.error = describeConnectError(error)
        await state.transport?.disconnect().catch(() => {})
        return toStatus(serverId, state)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onExternalAbort)
      }
    },
    async disconnect(serverId) {
      const state = states.get(serverId)
      if (state?.transport) {
        await state.transport.disconnect().catch((error: unknown) => {
          console.error(`[mcp] ${serverId} 断开失败（继续复位状态）：`, error)
        })
      }
      states.delete(serverId)
    },
    status: statusOf,
    statuses() {
      return options.repository.list().map((config) => statusOf(config.id))
    },
  }
}

function resolveSecretEnv(
  env: Record<string, string> | undefined,
  secrets: SecretStore,
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value.startsWith(SECRET_PREFIX)) {
      const ref = value.slice(SECRET_PREFIX.length)
      const secret = secrets.get(ref)
      if (secret === undefined) {
        throw new Error(`MCP 环境变量引用的密钥不存在：${ref}`)
      }
      resolved[key] = secret
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

function describeConnectError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return '连接超时：请检查启动命令 / URL 与服务可用性'
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '连接已取消'
  }
  return error instanceof Error ? error.message : String(error)
}
