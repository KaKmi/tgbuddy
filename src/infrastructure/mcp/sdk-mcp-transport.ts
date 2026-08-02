import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolResultSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServerConfig } from '../../shared/contracts/mcp.ts'
import type {
  McpTransport,
  McpToolDefinition,
  McpTransportFactory,
} from '../../runtime/mcp/ports/mcp-transport.ts'

/**
 * 基于官方 MCP SDK 的传输工厂：stdio 走子进程，http 走 SSE。
 * connect 完成 initialize 握手后才算连通。
 */
export class SdkMcpTransportFactory implements McpTransportFactory {
  create(config: McpServerConfig): McpTransport {
    return new SdkMcpTransport(config)
  }
}

class SdkMcpTransport implements McpTransport {
  readonly #client = new Client({
    name: 'tgbuddy',
    version: '0.1.0',
  })
  readonly #transport: Transport

  constructor(config: McpServerConfig) {
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error('stdio MCP 缺少启动命令')
      }
      this.#transport = new StdioClientTransport({
        command: config.command,
        ...(config.args && config.args.length > 0 ? { args: config.args } : {}),
        ...(config.env ? { env: config.env } : {}),
      })
    } else if (config.transport === 'http') {
      if (!config.url) throw new Error('http MCP 缺少 URL')
      this.#transport = new SSEClientTransport(new URL(config.url))
    } else {
      throw new Error(`未知 MCP 传输类型：${config.transport}`)
    }
  }

  async connect(signal: AbortSignal): Promise<void> {
    await this.#client.connect(this.#transport, { signal })
  }

  async disconnect(): Promise<void> {
    await this.#client.close()
  }

  isConnected(): boolean {
    return this.#client.getServerVersion() !== undefined
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.#client.listTools()
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    }))
  }

  async call(
    method: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ text: string; isError: boolean }> {
    const result = (await this.#client.callTool(
      { name: method, arguments: args },
      CallToolResultSchema,
      { signal },
    )) as CallToolResult
    const text = result.content
      .filter(
        (content): content is { type: 'text'; text: string } =>
          content.type === 'text',
      )
      .map((content) => content.text)
      .join('\n')
    return { text, isError: result.isError ?? false }
  }
}
