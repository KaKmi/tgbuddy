import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SETTINGS_PREFERENCES,
  readSettingsPreferences,
  writeSettingsPreferences,
} from '../src/renderer/features/settings/settings-preferences.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('设置偏好', () => {
  test('没有本地记录时返回安全默认值', () => {
    expect(readSettingsPreferences(new MemoryStorage())).toEqual(
      DEFAULT_SETTINGS_PREFERENCES,
    )
  })

  test('保存后恢复启动、权限模式与模型分工', () => {
    const storage = new MemoryStorage()
    const preferences = {
      restoreOnLaunch: false,
      defaultPermissionMode: 'plan' as const,
      primaryModel: 'deepseek:deepseek-chat',
      childModel: 'follow',
      compactionModel: 'local:qwen32b',
    }

    writeSettingsPreferences(storage, preferences)

    expect(readSettingsPreferences(storage)).toEqual(preferences)
  })

  test('损坏记录不会污染启动流程', () => {
    const storage = new MemoryStorage()
    storage.setItem('tgbuddy-settings', '{broken')

    expect(readSettingsPreferences(storage)).toEqual(
      DEFAULT_SETTINGS_PREFERENCES,
    )
  })
})
