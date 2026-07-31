import type { McpServerConfig } from '../../../shared/contracts/mcp.ts'

/** MCP 服务声明的工具定义（tools/list 结果）。 */
export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: unknown
}

/**
 * MCP 连接传输端口。Runtime 只依赖端口；进程/网络由
 * infrastructure 的 SDK adapter（Main 侧能力）实现。
 */
export interface McpTransport {
  connect(signal: AbortSignal): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  /** C10：发现服务提供的工具（tools/list） */
  listTools(): Promise<McpToolDefinition[]>
}

export interface McpTransportFactory {
  create(config: McpServerConfig): McpTransport
}
