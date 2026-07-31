export type McpTransportKind = 'stdio' | 'http'

/**
 * MCP 服务配置。环境变量值支持 `secret:<ref>` 前缀，
 * 连接时经 SecretStore 替换成明文，配置本身永不落明文。
 */
export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransportKind
  /** stdio：启动命令（如 npx @mcp/postgres） */
  command?: string
  args?: string[]
  /** http：SSE 端点 URL */
  url?: string
  env?: Record<string, string>
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type McpSaveInput = Omit<
  McpServerConfig,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: string }

export type McpServerState = 'off' | 'connecting' | 'connected' | 'error'

/** 设置页状态卡的数据基础。 */
export interface McpServerStatus {
  serverId: string
  state: McpServerState
  error?: string
  lastConnectedAt?: number
}
