import { describe, expect, test } from 'bun:test'
import type { Channel } from '../src/shared/contracts/channel.ts'
import type { Profile } from '../src/shared/contracts/profile.ts'
import { resolveModelChipLabel } from '../src/renderer/atoms/agent.ts'

const CHANNELS: Channel[] = [
  {
    id: 'ch-a',
    name: '渠道 A',
    protocol: 'openai',
    baseUrl: 'https://a.example.com',
    secretRef: 'secret_a',
    models: [
      { id: 'model-a1', name: '模型 A1', contextWindow: 128_000, maxTokens: 64_000 },
    ],
  },
  {
    id: 'ch-b',
    name: '渠道 B',
    protocol: 'openai',
    baseUrl: 'https://b.example.com',
    models: [
      { id: 'model-b1', name: '模型 B1', contextWindow: 200_000, maxTokens: 32_000 },
    ],
  },
]

const PROFILES: Profile[] = [
  {
    id: 'profile-1',
    name: '风险分析专家',
    channelId: 'ch-a',
    modelId: 'model-a1',
    createdAt: 1,
    updatedAt: 1,
  },
]

describe('输入区模型 chip 显示文本', () => {
  test('会话选中 Profile 时优先显示 Profile 名', () => {
    expect(
      resolveModelChipLabel(
        { profileId: 'profile-1', channelId: 'ch-a', modelId: 'model-a1' },
        CHANNELS,
        PROFILES,
      ),
    ).toBe('风险分析专家')
  })

  test('会话直接指定模型时显示模型名', () => {
    expect(
      resolveModelChipLabel({ channelId: 'ch-b', modelId: 'model-b1' }, CHANNELS, PROFILES),
    ).toBe('模型 B1')
  })

  test('无任何选择时显示首个渠道的首个模型', () => {
    expect(resolveModelChipLabel(undefined, CHANNELS, PROFILES)).toBe('模型 A1')
  })

  test('没有渠道时提示选择模型', () => {
    expect(resolveModelChipLabel(undefined, [], [])).toBe('选择模型')
  })
})
