import type {
  ToolPermission,
  ToolSettingView,
} from '../../shared/contracts/tool.ts'
import type { ToolRegistry } from './tool-registry.ts'
import type { ToolSettingsRepository } from './tool-settings-repository.ts'

export interface CreateToolSettingsServiceOptions {
  registry: ToolRegistry
  repository: ToolSettingsRepository
  now(): number
}

export interface ToolSettingsService {
  /** 设置页列表：registry 全部工具 + 覆盖后的最终权限 */
  listTools(): ToolSettingView[]
  /** PolicyEngine 钩子：按工具名取最终权限，无覆盖时回退内置默认 */
  getPermission(toolName: string): ToolPermission | undefined
  set(toolId: string, permission: ToolPermission): void
  /** 恢复推荐：删除该工具覆盖 */
  reset(toolId: string): void
  /** 恢复全部推荐 */
  resetAll(): void
  /** 批量改为询问 */
  bulkSetAsk(toolIds: string[]): void
}

/**
 * 工具三档权限设置。UI 的值与 Tool 实例分离：
 * 设置只存覆盖项，Run 启动时由 registry snapshot + 本服务解析最终权限。
 */
export function createToolSettingsService(
  options: CreateToolSettingsServiceOptions,
): ToolSettingsService {
  const overrides = new Map(
    options.repository.list().map((setting) => [setting.toolId, setting.permission]),
  )

  const effective = (toolId: string): ToolPermission => {
    const override = overrides.get(toolId)
    if (override) return override
    return (
      options.registry.list().find((descriptor) => descriptor.id === toolId)
        ?.defaultPermission ?? 'ask'
    )
  }

  return {
    listTools() {
      return options.registry.list().map((descriptor) => ({
        id: descriptor.id,
        name: descriptor.name,
        label: descriptor.label,
        description: descriptor.description,
        category: descriptor.category,
        source: descriptor.source,
        enabled: descriptor.enabled,
        permission: effective(descriptor.id),
        ...(descriptor.note ? { note: descriptor.note } : {}),
      }))
    },
    getPermission(toolName) {
      const descriptor = options.registry
        .list()
        .find((item) => item.name === toolName)
      if (!descriptor) return undefined
      return effective(descriptor.id)
    },
    set(toolId, permission) {
      overrides.set(toolId, permission)
      options.repository.set({
        toolId,
        permission,
        updatedAt: options.now(),
      })
    },
    reset(toolId) {
      overrides.delete(toolId)
      options.repository.remove(toolId)
    },
    resetAll() {
      overrides.clear()
      options.repository.clear()
    },
    bulkSetAsk(toolIds) {
      for (const toolId of toolIds) {
        overrides.set(toolId, 'ask')
        options.repository.set({
          toolId,
          permission: 'ask',
          updatedAt: options.now(),
        })
      }
    },
  }
}
