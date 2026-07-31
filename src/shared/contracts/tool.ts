/** 工具三档权限（C06 设置页与 PolicyEngine 共用）。 */
export type ToolPermission = 'allow' | 'ask' | 'deny'

export type ToolCategory = 'builtin' | 'mcp'

/**
 * 统一工具描述符。C05 起所有工具（内置 / 未来 MCP）都经注册表登记，
 * Run 启动时按 snapshot 冻结可用集合。
 */
export interface ToolDescriptor {
  /** 稳定 id：内置工具用工具名，MCP 工具用 server.method */
  id: string
  /** pi 调用名（与 Harness 收到的事件名一致） */
  name: string
  label: string
  description: string
  category: ToolCategory
  /** 来源渠道：内置工具是「内置」，MCP 工具是服务名 */
  source: string
  /** 推荐三档权限（C06 设置默认值） */
  defaultPermission: ToolPermission
  /** 是否启用；snapshot 只含启用工具 */
  enabled: boolean
  /** 附加说明（如 bash 的破坏性命令提示） */
  note?: string
}
