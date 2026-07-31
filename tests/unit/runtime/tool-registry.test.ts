import { describe, expect, test } from 'bun:test'
import {
  createToolRegistry,
  type ToolRegistry,
} from '../../../src/runtime/tools/tool-registry.ts'
import type { ToolDescriptor } from '../../../src/shared/contracts/tool.ts'
import { createBuiltinToolRegistry } from '../../../src/runtime/tools/builtin-tools.ts'

function descriptor(id: string, name = id): ToolDescriptor {
  return {
    id,
    name,
    label: `工具 ${id}`,
    description: `描述 ${id}`,
    category: 'builtin',
    source: '内置',
    defaultPermission: 'ask',
    enabled: true,
  }
}

describe('ToolRegistry', () => {
  test('按注册顺序列出工具，启用状态稳定', () => {
    const registry: ToolRegistry = createToolRegistry({
      descriptors: [descriptor('a'), descriptor('b'), descriptor('c')],
    })
    expect(registry.list().map((tool) => tool.id)).toEqual(['a', 'b', 'c'])
  })

  test('同名冲突：重复 id 注册被拒绝，避免 MCP 与内置工具撞名', () => {
    expect(() =>
      createToolRegistry({
        descriptors: [descriptor('read'), descriptor('read')],
      }),
    ).toThrow(/重复/)
  })

  test('enable/disable 影响 snapshot，但 list 始终返回全部描述符', () => {
    const registry = createToolRegistry({
      descriptors: [descriptor('a'), descriptor('b')],
    })
    registry.setEnabled('b', false)

    expect(registry.list()).toHaveLength(2)
    expect(registry.snapshot().map((tool) => tool.id)).toEqual(['a'])
    registry.setEnabled('b', true)
    expect(registry.snapshot().map((tool) => tool.id)).toEqual(['a', 'b'])
  })

  test('snapshot 是冻结副本：运行中改设置不影响已冻结列表', () => {
    const registry = createToolRegistry({
      descriptors: [descriptor('a'), descriptor('b')],
    })
    const frozen = registry.snapshot()
    registry.setEnabled('b', false)

    expect(frozen.map((tool) => tool.id)).toEqual(['a', 'b'])
    expect(registry.snapshot().map((tool) => tool.id)).toEqual(['a'])
  })

  test('未知工具 id 的 setEnabled 抛出可诊断错误', () => {
    const registry = createToolRegistry({ descriptors: [descriptor('a')] })
    expect(() => registry.setEnabled('nope', false)).toThrow(/工具/)
  })
})

describe('内置工具 adapter', () => {
  test('read/write/bash/ask_user 等内置工具全部经统一 descriptor 注册，计划工具已移出工具区', () => {
    const registry = createBuiltinToolRegistry()
    const ids = registry.list().map((tool) => tool.id)
    for (const expected of [
      'read',
      'write',
      'edit',
      'bash',
      'delete',
      'glob',
      'ask_user',
    ]) {
      expect(ids).toContain(expected)
    }
    expect(ids).not.toContain('enter_plan_mode')
    expect(ids).not.toContain('exit_plan_mode')
  })

  test('读类工具默认 allow，写与命令默认 ask', () => {
    const registry = createBuiltinToolRegistry()
    const byId = new Map(registry.list().map((tool) => [tool.id, tool]))
    expect(byId.get('read')?.defaultPermission).toBe('allow')
    expect(byId.get('glob')?.defaultPermission).toBe('allow')
    expect(byId.get('write')?.defaultPermission).toBe('ask')
    expect(byId.get('bash')?.defaultPermission).toBe('ask')
  })
})
