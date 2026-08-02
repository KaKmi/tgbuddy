import type { ToolDescriptor } from '../../shared/contracts/tool.ts'

export interface ToolRegistry {
  /** 全部描述符（含禁用），顺序为注册顺序 */
  list(): ToolDescriptor[]
  setEnabled(toolId: string, enabled: boolean): void
  /** C10：动态注册（MCP 工具）；重复 id 抛错 */
  register(descriptors: ToolDescriptor[]): void
  /** C10：注销（MCP 断开），只影响下一 Run 快照 */
  unregister(toolIds: string[]): void
  /** Run 启动时冻结：只含启用工具，返回副本 */
  snapshot(): ToolDescriptor[]
}

export interface CreateToolRegistryOptions {
  descriptors: ToolDescriptor[]
}

/**
 * 工具注册表。同名冲突在注册时拒绝（C10 的 MCP server.method
 * 与内置工具撞名也必须在这里暴露）。snapshot 每次返回新数组，
 * 保证 Run 启动后设置变更不影响已冻结集合。
 */
export function createToolRegistry(
  options: CreateToolRegistryOptions,
): ToolRegistry {
  const byId = new Map<string, ToolDescriptor>()
  for (const descriptor of options.descriptors) {
    if (byId.has(descriptor.id)) {
      throw new Error(`工具 id 重复注册：${descriptor.id}`)
    }
    byId.set(descriptor.id, descriptor)
  }

  return {
    list: () => [...byId.values()],
    setEnabled(toolId, enabled) {
      const descriptor = byId.get(toolId)
      if (!descriptor) throw new Error(`工具不存在：${toolId}`)
      byId.set(toolId, { ...descriptor, enabled })
    },
    register(descriptors) {
      for (const descriptor of descriptors) {
        if (byId.has(descriptor.id)) {
          throw new Error(`工具 id 重复注册：${descriptor.id}`)
        }
        byId.set(descriptor.id, descriptor)
      }
    },
    unregister(toolIds) {
      for (const toolId of toolIds) byId.delete(toolId)
    },
    snapshot: () =>
      [...byId.values()]
        .filter((descriptor) => descriptor.enabled)
        .map((descriptor) => ({ ...descriptor })),
  }
}
