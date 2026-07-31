import type { Profile, ProfileSaveInput } from '../../shared/contracts/profile.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type { ProfileRepository } from './profile-repository.ts'

export interface CreateProfileServiceOptions {
  repository: ProfileRepository
  createId(): string
  now(): number
}

export interface ProfileService {
  list(): Profile[]
  get(profileId: string): Profile | undefined
  save(input: ProfileSaveInput): Profile
  delete(profileId: string): void
  /** 默认 Profile：无显式选择时新会话使用的预设（取最早创建的） */
  default(): Profile | undefined
}

/**
 * Run 启动时固化的模型选择快照。
 * 值对象：每次解析都新建，后续设置变更不影响已启动的 Run。
 */
export interface ModelSelectionSnapshot {
  profileId?: string
  channelId: string
  modelId: string
  systemPrompt?: string
}

/**
 * 把 Session 元数据解析成 Run 的模型选择快照：
 * 1. 会话显式 Profile（不可变预设）；
 * 2. 会话直接指定的 channelId/modelId；
 * 3. 默认 Profile；
 * 4. 都没有则返回 undefined（调用方按渠道首个模型兜底）。
 */
export function resolveModelSelection(
  meta: Pick<SessionMeta, 'profileId' | 'channelId' | 'modelId'>,
  profiles: ProfileService,
): ModelSelectionSnapshot | undefined {
  if (meta.profileId) {
    const profile = profiles.get(meta.profileId)
    if (profile) {
      return {
        profileId: profile.id,
        channelId: profile.channelId,
        modelId: profile.modelId,
        systemPrompt: profile.systemPrompt,
      }
    }
  }
  if (meta.channelId) {
    return {
      channelId: meta.channelId,
      modelId: meta.modelId ?? '',
    }
  }
  const fallback = profiles.default()
  if (fallback) {
    return {
      profileId: fallback.id,
      channelId: fallback.channelId,
      modelId: fallback.modelId,
      systemPrompt: fallback.systemPrompt,
    }
  }
  return undefined
}

export function createProfileService(
  options: CreateProfileServiceOptions,
): ProfileService {
  const save = (input: ProfileSaveInput): Profile => {
    const now = options.now()
    const existing = input.id ? options.repository.get(input.id) : undefined
    const profile: Profile = {
      id: input.id ?? options.createId(),
      name: input.name,
      channelId: input.channelId,
      modelId: input.modelId,
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    return options.repository.save(profile)
  }

  return {
    list: () => options.repository.list(),
    get: (profileId) => options.repository.get(profileId),
    save,
    delete: (profileId) => options.repository.delete(profileId),
    default: () => options.repository.list()[0],
  }
}
