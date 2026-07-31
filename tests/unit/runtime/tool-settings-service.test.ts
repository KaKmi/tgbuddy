import { describe, expect, test } from 'bun:test'
import { createBuiltinToolRegistry } from '../../../src/runtime/tools/builtin-tools.ts'
import type { ToolRegistry } from '../../../src/runtime/tools/tool-registry.ts'
import {
  createToolSettingsService,
  type ToolSettingsService,
} from '../../../src/runtime/tools/tool-settings-service.ts'
import { MemoryToolSettingsRepository } from '../../../src/runtime/tools/tool-settings-repository.ts'

function createFixture(): {
  settings: ToolSettingsService
  registry: ToolRegistry
} {
  const registry = createBuiltinToolRegistry()
  const settings = createToolSettingsService({
    registry,
    repository: new MemoryToolSettingsRepository(),
    now: () => 1_000,
  })
  return { settings, registry }
}

describe('ToolSettingsService', () => {
  test('无覆盖时用内置默认：读 allow、写 ask', () => {
    const { settings } = createFixture()
    expect(settings.getPermission('read')).toBe('allow')
    expect(settings.getPermission('write')).toBe('ask')
    expect(settings.getPermission('bash')).toBe('ask')
  })

  test('单工具覆盖生效并持久化到 repository', () => {
    const repository = new MemoryToolSettingsRepository()
    const settings = createToolSettingsService({
      registry: createBuiltinToolRegistry(),
      repository,
      now: () => 1_000,
    })
    settings.set('write', 'deny')

    expect(settings.getPermission('write')).toBe('deny')
    expect(repository.list()).toEqual([
      { toolId: 'write', permission: 'deny', updatedAt: 1_000 },
    ])
    const view = settings.listTools().find((tool) => tool.id === 'write')
    expect(view?.permission).toBe('deny')
  })

  test('恢复推荐删除覆盖，回退内置默认', () => {
    const { settings } = createFixture()
    settings.set('read', 'deny')
    settings.reset('read')
    expect(settings.getPermission('read')).toBe('allow')
  })

  test('批量改为询问 + 恢复全部推荐', () => {
    const { settings } = createFixture()
    settings.bulkSetAsk(['read', 'glob', 'write'])
    expect(settings.getPermission('read')).toBe('ask')
    expect(settings.getPermission('glob')).toBe('ask')
    expect(settings.getPermission('write')).toBe('ask')

    settings.resetAll()
    expect(settings.getPermission('read')).toBe('allow')
    expect(settings.getPermission('write')).toBe('ask')
  })

  test('禁用工具仍在列表（带 enabled=false），snapshot 由 registry 排除', () => {
    const { settings, registry } = createFixture()
    registry.setEnabled('read', false)
    const view = settings.listTools().find((tool) => tool.id === 'read')
    expect(view?.enabled).toBe(false)
    expect(settings.getPermission('read')).toBe('allow')
  })

  test('未注册工具返回 undefined，PolicyEngine 走内置兜底', () => {
    const { settings } = createFixture()
    expect(settings.getPermission('some_mcp_tool')).toBeUndefined()
  })
})
