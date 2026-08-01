import { describe, expect, test } from 'bun:test'
import type { Profile } from '../src/shared/contracts/profile.ts'
import {
  composerKeyShouldSend,
  profileSkillSummary,
} from '../src/renderer/features/composer/composer-state.ts'

describe('Composer 交互状态', () => {
  test('Enter 发送，Shift+Enter 与中文输入法组词时不发送', () => {
    expect(composerKeyShouldSend({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(composerKeyShouldSend({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    expect(composerKeyShouldSend({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })

  test('专家技能摘要区分自动、明确关闭和指定技能', () => {
    const base: Profile = {
      id: 'profile-1',
      name: '风险分析专家',
      channelId: 'channel-1',
      modelId: 'model-1',
      createdAt: 1,
      updatedAt: 1,
    }
    expect(profileSkillSummary(base)).toBe('技能自动匹配')
    expect(profileSkillSummary({ ...base, skillIds: [] })).toBe('不使用技能')
    expect(profileSkillSummary({ ...base, skillIds: ['a', 'b'] })).toBe('2 个技能')
  })
})
