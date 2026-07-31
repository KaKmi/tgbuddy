import type { McpServerConfig } from '../../../shared/contracts/mcp.ts'

/**
 * MCP 连接传输端口。Runtime 只依赖端口；进程/网络由
 * infrastructure 的 SDK adapter（Main 侧能力）实现。
 */
export interface McpTransport {
  connect(signal: AbortSignal): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
}

export interface McpTransportFactory {
  create(config: McpServerConfig): McpTransport
}
