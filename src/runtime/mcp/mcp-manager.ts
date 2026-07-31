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
  McpToolDefinition,
  McpTransportFactory,
} from './ports/mcp-transport.ts'
import type { ToolDescriptor, ToolPermission } from '../../shared/contracts/tool.ts'
import type { ToolRegistry } from '../tools/tool-registry.ts'

export interface CreateMcpManagerOptions {
  repository: McpConfigRepository
  factory: McpTransportFactory
  secrets: SecretStore
  /** C10：发现的 MCP 工具注册进统一注册表 */
  toolRegistry: ToolRegistry
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
  const serverTools = new Map<string, string[]>()
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

  const unregisterServerTools = (serverId: string): void => {
    const toolIds = serverTools.get(serverId)
    if (toolIds && toolIds.length > 0) options.toolRegistry.unregister(toolIds)
    serverTools.delete(serverId)
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
        key: input.key?.trim() || slugifyServerKey(input.name),
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
      unregisterServerTools(config.id)
      return config
    },
    delete(serverId) {
      dropConnection(serverId)
      unregisterServerTools(serverId)
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
        const tools = await transport.listTools()
        const descriptors = buildMcpToolDescriptors(config, tools)
        registerMcpTools(
          options.toolRegistry,
          config.id,
          descriptors,
          serverTools,
        )
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
      unregisterServerTools(serverId)
    },
    status: statusOf,
    statuses() {
      return options.repository.list().map((config) => statusOf(config.id))
    },
  }
}

function slugifyServerKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'mcp'
}

const READ_PREFIXES = ['get', 'list', 'search', 'read', 'fetch', 'query']

function buildMcpToolDescriptors(
  config: McpServerConfig,
  tools: McpToolDefinition[],
): ToolDescriptor[] {
  return tools.map((tool) => {
    const name = `${config.key}.${tool.name}`
    return {
      id: name,
      name,
      label: tool.name,
      description: tool.description ?? 'MCP 服务提供的工具',
      category: 'mcp',
      source: config.name,
      defaultPermission: defaultMcpPermission(tool.name),
      enabled: true,
    }
  })
}

function defaultMcpPermission(method: string): ToolPermission {
  const first = method.split(/[._-]/)[0]?.toLowerCase()
  return first && READ_PREFIXES.includes(first) ? 'allow' : 'ask'
}

/**
 * 注册前先校验与其它服务的重名冲突，避免注册表一半生效。
 * 自己的旧工具先注销，再注册新清单（schema 变化场景）。
 */
function registerMcpTools(
  registry: ToolRegistry,
  serverId: string,
  descriptors: ToolDescriptor[],
  serverTools: Map<string, string[]>,
): void {
  const previous = serverTools.get(serverId) ?? []
  const ownIds = new Set(previous)
  const existingIds = new Set(
    registry.list().filter((tool) => !ownIds.has(tool.id)).map((tool) => tool.id),
  )
  const conflict = descriptors.find((descriptor) => existingIds.has(descriptor.id))
  if (conflict) {
    throw new Error(
      `工具名与其它服务冲突：${conflict.id}，请修改服务标识（key）或方法名`,
    )
  }
  if (previous.length > 0) registry.unregister(previous)
  registry.register(descriptors)
  serverTools.set(serverId, descriptors.map((descriptor) => descriptor.id))
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
