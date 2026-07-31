import type { ToolPermission } from '../../shared/contracts/tool.ts'

export interface ToolPermissionSetting {
  toolId: string
  permission: ToolPermission
  updatedAt: number
}

/**
 * 工具三档权限设置的持久化端口。
 * 只有「用户显式覆盖」落库；未覆盖的工具继续用内置默认。
 */
export interface ToolSettingsRepository {
  list(): ToolPermissionSetting[]
  set(setting: ToolPermissionSetting): void
  remove(toolId: string): void
  clear(): void
}

export class MemoryToolSettingsRepository implements ToolSettingsRepository {
  readonly #settings = new Map<string, ToolPermissionSetting>()

  list(): ToolPermissionSetting[] {
    return [...this.#settings.values()]
  }

  set(setting: ToolPermissionSetting): void {
    this.#settings.set(setting.toolId, setting)
  }

  remove(toolId: string): void {
    this.#settings.delete(toolId)
  }

  clear(): void {
    this.#settings.clear()
  }
}
