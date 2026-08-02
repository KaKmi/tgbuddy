import type {
  Channel,
  ChannelModel,
  ChannelSaveInput,
} from '../../shared/contracts/channel.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type { Profile } from '../../shared/contracts/profile.ts'
import { createSecretRef, type SecretStore } from '../secrets/secret-store.ts'
import type { ChannelRepository } from './channel-repository.ts'

export interface CreateChannelServiceOptions {
  repository: ChannelRepository
  secrets: SecretStore
  /** 删除渠道前检查是否仍被会话引用 */
  sessions: { list(): SessionMeta[] }
  /** 删除渠道前检查是否仍被 Profile 引用 */
  profiles: { list(): Profile[] }
  createId(): string
}

export interface ChannelService {
  /** 设置页用：只含 secret ref，不含明文 */
  list(): Channel[]
  /** 保存渠道；apiKey 非空时写入 SecretStore，落库的只有 ref */
  save(input: ChannelSaveInput): Channel
  /** 被 Session 引用时拒绝删除 */
  delete(channelId: string): void
  /**
   * 运行期解析：返回带明文 apiKey 的渠道。
   * 只允许 Runtime 内部在内核调用前使用，绝不暴露给 IPC。
   */
  resolve(channelId?: string): Channel | undefined
  resolveAll(): Channel[]
  /**
   * 合并模型发现结果：保留已有模型的精确规格，把新发现 id 追加进列表。
   * 返回保存后的渠道（无明文）。
   */
  applyDiscoveredModels(channelId: string, discovered: ChannelModel[]): Channel
}

/**
 * 渠道用例。密钥明文只经 SecretStore 进出：结构化的 SQLite / IPC 数据
 * 永远只保存 `secretRef`，读取结果也不回传明文。
 */
export function createChannelService(
  options: CreateChannelServiceOptions,
): ChannelService {
  const save = (input: ChannelSaveInput): Channel => {
    const id = input.id ?? options.createId()
    const existing = options.repository.get(id)
    const plaintext = input.apiKey?.trim()
    let secretRef = input.secretRef ?? existing?.secretRef
    if (plaintext) {
      secretRef = secretRef ?? createSecretRef(options.createId)
      options.secrets.set(secretRef, plaintext)
    }
    const channel: Channel = {
      id,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      models: input.models,
      ...(secretRef ? { secretRef } : {}),
    }
    return options.repository.save(channel)
  }

  const resolveOne = (channel: Channel): Channel => {
    if (!channel.secretRef) return channel
    const secret = options.secrets.get(channel.secretRef)
    if (secret === undefined) {
      throw new Error(
        `渠道「${channel.name}」的密钥引用已失效（${channel.secretRef}），请重新保存密钥`,
      )
    }
    return { ...channel, apiKey: secret }
  }

  return {
    list: () => options.repository.list(),
    save,
    delete(channelId) {
      const referenced = options.sessions
        .list()
        .some((session) => session.channelId === channelId)
      if (referenced) {
        throw new Error('仍有会话使用该渠道，请先切换会话模型再删除')
      }
      const profileReferenced = options.profiles
        .list()
        .some((profile) => profile.channelId === channelId)
      if (profileReferenced) {
        throw new Error('仍有 Profile 使用该渠道，请先调整 Profile 再删除')
      }
      const channel = options.repository.get(channelId)
      if (!channel) return
      if (channel.secretRef) options.secrets.delete(channel.secretRef)
      options.repository.delete(channelId)
    },
    resolve(channelId) {
      const channels = options.repository.list()
      const channel =
        channels.find((item) => item.id === channelId) ?? channels[0]
      return channel ? resolveOne(channel) : undefined
    },
    resolveAll: () => options.repository.list().map(resolveOne),
    applyDiscoveredModels(channelId, discovered) {
      const existing = options.repository.get(channelId)
      if (!existing) throw new Error(`渠道不存在：${channelId}`)
      const merged = [...existing.models]
      for (const model of discovered) {
        if (!merged.some((item) => item.id === model.id)) merged.push(model)
      }
      return save({ ...existing, models: merged })
    },
  }
}
