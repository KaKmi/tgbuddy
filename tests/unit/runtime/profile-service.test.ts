import { describe, expect, test } from 'bun:test'
import type { ProfileSaveInput } from '../../../src/shared/contracts/profile.ts'
import {
  createProfileService,
  resolveModelSelection,
  type ProfileService,
} from '../../../src/runtime/profiles/profile-service.ts'
import { MemoryProfileRepository } from '../../../src/runtime/profiles/profile-repository.ts'

function createFixture(): { profiles: ProfileService; counter: () => number } {
  let counter = 0
  let nowCounter = 0
  const profiles = createProfileService({
    repository: new MemoryProfileRepository(),
    createId: () => `profile-${++counter}`,
    now: () => 1_000 + ++nowCounter,
  })
  return { profiles, counter: () => counter }
}

function profileInput(overrides: Partial<ProfileSaveInput> = {}): ProfileSaveInput {
  return {
    name: '风险分析专家',
    channelId: 'ch-deepseek',
    modelId: 'deepseek-v4-pro',
    systemPrompt: '你擅长风险分析',
    ...overrides,
  }
}

describe('ProfileService', () => {
  test('保存/列出/读取 Profile，新预设由 Runtime 生成 id 与时间戳', () => {
    const { profiles } = createFixture()
    const created = profiles.save(profileInput())

    expect(created.id).toBe('profile-1')
    expect(created.createdAt).toBe(1_001)
    expect(profiles.list()).toHaveLength(1)
    expect(profiles.get('profile-1')?.name).toBe('风险分析专家')
  })

  test('默认 Profile 是第一个创建的；删除后回退到下一个', () => {
    const { profiles } = createFixture()
    profiles.save(profileInput({ name: '第一个' }))
    profiles.save(profileInput({ name: '第二个' }))
    expect(profiles.default()?.name).toBe('第一个')

    profiles.delete('profile-1')
    expect(profiles.default()?.name).toBe('第二个')
  })

  test('编辑 Profile 保留 createdAt 并刷新 updatedAt', () => {
    const { profiles } = createFixture()
    const created = profiles.save(profileInput())
    const edited = profiles.save(profileInput({ id: created.id, name: '改名' }))
    expect(edited.createdAt).toBe(created.createdAt)
    expect(edited.updatedAt).toBeGreaterThan(created.updatedAt)
  })
})

describe('resolveModelSelection', () => {
  test('会话显式 Profile 优先于会话直接指定的模型', () => {
    const { profiles } = createFixture()
    const profile = profiles.save(profileInput())

    const snapshot = resolveModelSelection(
      {
        profileId: profile.id,
        channelId: 'ch-other',
        modelId: 'other-model',
      },
      profiles,
    )
    expect(snapshot).toEqual({
      profileId: 'profile-1',
      channelId: 'ch-deepseek',
      modelId: 'deepseek-v4-pro',
      systemPrompt: '你擅长风险分析',
    })
  })

  test('无 Profile 时使用会话直接指定的 channelId/modelId', () => {
    const { profiles } = createFixture()
    const snapshot = resolveModelSelection(
      { channelId: 'ch-a', modelId: 'model-a' },
      profiles,
    )
    expect(snapshot?.channelId).toBe('ch-a')
    expect(snapshot?.modelId).toBe('model-a')
  })

  test('无任何选择时回退默认 Profile', () => {
    const { profiles } = createFixture()
    profiles.save(profileInput())
    const snapshot = resolveModelSelection({}, profiles)
    expect(snapshot?.profileId).toBe('profile-1')
  })

  test('设置变更后旧 Run 的 snapshot 不变（每次解析新建值对象）', () => {
    const { profiles } = createFixture()
    const profile = profiles.save(profileInput())
    const first = resolveModelSelection({ profileId: profile.id }, profiles)
    expect(first?.modelId).toBe('deepseek-v4-pro')

    // 运行期间用户把 Profile 改成另一个模型
    profiles.save(profileInput({ id: profile.id, modelId: 'deepseek-v4-flash' }))
    const second = resolveModelSelection({ profileId: profile.id }, profiles)
    expect(second?.modelId).toBe('deepseek-v4-flash')

    // 已启动 Run 的快照仍是旧值
    expect(first?.modelId).toBe('deepseek-v4-pro')
  })
})
