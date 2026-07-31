import type { McpServerConfig } from '../../../shared/contracts/mcp.ts'

/** MCP 服务声明的工具定义（tools/list 结果）。 */
export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpCallResult {
  text: string
  /** MCP 结构化错误（isError=true）时由调用方抛到工具层 */
  isError: boolean
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
  /** C11：调用服务方法（tools/call） */
  call(
    method: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<McpCallResult>
}

export interface McpTransportFactory {
  create(config: McpServerConfig): McpTransport
}
