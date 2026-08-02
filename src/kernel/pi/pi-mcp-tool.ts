import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'

export interface BuildMcpToolOptions {
  toolId: string
  method: string
  label: string
  description: string
  expectedIdentity?: string
  assertIdentity?(expected: string): void
  call(
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<string>
}

/**
 * MCP 工具适配（pi adapter）。参数 schema 用宽松 Record：
 * 精确 JSON Schema 校验由 MCP 服务端执行，这里只保证透传。
 */
export function buildMcpTool(options: BuildMcpToolOptions): AgentTool {
  return {
    name: options.toolId,
    label: options.label,
    description: options.description,
    parameters: Type.Record(Type.String(), Type.Unknown()),
    execute: async (_id, params, signal) => {
      const args = (params ?? {}) as Record<string, unknown>
      if (!options.expectedIdentity || !options.assertIdentity) {
        const error = new Error('MCP 工具缺少授权身份绑定')
        Object.assign(error, { code: 'authorization_binding_missing' })
        throw error
      }
      options.assertIdentity(options.expectedIdentity)
      // 结构化错误（isError）与断线由调用方（McpManager）转成 throw。
      const text = await options.call(args, signal)
      return {
        content: [{ type: 'text', text }],
        details: { action: 'read', mcp: options.toolId },
      }
    },
  }
}
