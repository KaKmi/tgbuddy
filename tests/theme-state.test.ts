import { describe, expect, test } from 'bun:test'
import {
  applyTheme,
  readTheme,
  toggleTheme,
  writeTheme,
} from '../src/renderer/features/theme/theme-state.ts'

interface FakeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function createStorage(initial?: string): FakeStorage {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set('tgbuddy-theme', initial)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('Renderer 主题状态', () => {
  test('空值和非法值都回退为明亮主题', () => {
    expect(readTheme(createStorage())).toBe('light')
    expect(readTheme(createStorage('system'))).toBe('light')
  })

  test('只在 light 和 dark 之间切换', () => {
    expect(toggleTheme('light')).toBe('dark')
    expect(toggleTheme('dark')).toBe('light')
  })

  test('写入固定持久化键', () => {
    const storage = createStorage()
    writeTheme(storage, 'dark')
    expect(readTheme(storage)).toBe('dark')
  })

  test('将主题写到根节点 data-theme，不遗留 dark class', () => {
    const attributes = new Map<string, string>()
    const root = {
      classList: { remove: (name: string) => attributes.set(`removed:${name}`, 'true') },
      dataset: {} as Record<string, string>,
    }

    applyTheme(root, 'dark')

    expect(root.dataset.theme).toBe('dark')
    expect(attributes.get('removed:dark')).toBe('true')
  })
})
