import { describe, expect, test } from 'bun:test'
import type { Channel } from '../../../src/shared/contracts/channel.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'
import type { SecretRef } from '../../../src/shared/contracts/secret.ts'
import {
  MemorySecretStore,
  type SecretStore,
} from '../../../src/runtime/secrets/secret-store.ts'
import type { ChannelRepository } from '../../../src/runtime/channels/channel-repository.ts'
import {
  createChannelService,
  type ChannelService,
} from '../../../src/runtime/channels/channel-service.ts'

class MemoryChannelRepository implements ChannelRepository {
  readonly #channels = new Map<string, Channel>()

  list(): Channel[] {
    return [...this.#channels.values()]
  }

  get(channelId: string): Channel | undefined {
    return this.#channels.get(channelId)
  }

  save(channel: Channel): Channel {
    this.#channels.set(channel.id, channel)
    return channel
  }

  delete(channelId: string): void {
    this.#channels.delete(channelId)
  }
}

class MemorySessionList {
  readonly items: SessionMeta[] = []

  list(): SessionMeta[] {
    return this.items
  }
}

function channelInput(
  overrides: Partial<Channel> = {},
): Channel {
  return {
    id: 'ch-deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-plaintext-input',
    models: [],
    ...overrides,
  }
}

function createFixture(): {
  service: ChannelService
  secrets: SecretStore
  repository: MemoryChannelRepository
  sessions: MemorySessionList
} {
  const repository = new MemoryChannelRepository()
  const secrets = new MemorySecretStore()
  const sessions = new MemorySessionList()
  let counter = 0
  const service = createChannelService({
    repository,
    secrets,
    sessions,
    createId: () => `id-${++counter}`,
  })
  return { service, secrets, repository, sessions }
}

describe('ChannelService', () => {
  test('保存渠道时明文只进 SecretStore，list 只返回 secret ref', () => {
    const { service, secrets } = createFixture()
    service.save(channelInput())

    const listed = service.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.apiKey).toBeUndefined()
    expect(listed[0]?.secretRef).toBe('secret_id-1')
    expect(secrets.get('secret_id-1' as SecretRef)).toBe('sk-plaintext-input')
  })

  test('不带 id 的新渠道由 Runtime 生成 id', () => {
    const { service } = createFixture()
    const created = service.save({
      ...channelInput(),
      id: undefined,
    })
    expect(created.id).toBe('id-1')
    expect(created.secretRef).toBe('secret_id-2')
  })

  test('编辑渠道不提供新密钥时保留原 secret ref', () => {
    const { service } = createFixture()
    const created = service.save(channelInput())
    const edited = service.save({
      ...channelInput(),
      name: 'DeepSeek 中转',
      apiKey: undefined,
    })

    expect(edited.secretRef).toBe(created.secretRef)
    expect(service.list()[0]?.name).toBe('DeepSeek 中转')
  })

  test('更新密钥覆盖同一 ref 下的明文', () => {
    const { service, secrets } = createFixture()
    service.save(channelInput())
    service.save(channelInput({ apiKey: 'sk-new-key' }))

    expect(secrets.get('secret_id-1' as SecretRef)).toBe('sk-new-key')
    expect(service.list()[0]?.secretRef).toBe('secret_id-1')
  })

  test('删除渠道时同时删除对应密钥', () => {
    const { service, secrets } = createFixture()
    service.save(channelInput())
    service.delete('ch-deepseek')

    expect(service.list()).toHaveLength(0)
    expect(secrets.get('secret_id-1' as SecretRef)).toBeUndefined()
  })

  test('删除被 Session 引用的渠道被拒绝', () => {
    const { service, sessions } = createFixture()
    service.save(channelInput())
    sessions.items.push({
      id: 'session-1',
      title: '引用渠道的会话',
      channelId: 'ch-deepseek',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(() => service.delete('ch-deepseek')).toThrow(/会话/)
    expect(service.list()).toHaveLength(1)
  })

  test('resolve 返回带明文密钥的渠道（默认取第一个，或按 id）', () => {
    const { service } = createFixture()
    service.save(channelInput())
    service.save(
      channelInput({
        id: 'ch-second',
        name: '第二渠道',
        apiKey: 'sk-second',
      }),
    )

    const byId = service.resolve('ch-second')
    expect(byId?.apiKey).toBe('sk-second')
    const fallback = service.resolve()
    expect(fallback?.id).toBe('ch-deepseek')
    expect(fallback?.apiKey).toBe('sk-plaintext-input')
  })

  test('resolveAll 全部带明文，供运行期构建模型', () => {
    const { service } = createFixture()
    service.save(channelInput())
    service.save(channelInput({ id: 'ch-b', apiKey: 'sk-b' }))

    const resolved = service.resolveAll()
    expect(resolved).toHaveLength(2)
    expect(resolved.every((channel) => typeof channel.apiKey === 'string')).toBe(true)
  })

  test('secret ref 失效（密钥丢失）时 resolve 抛出可诊断错误', () => {
    const { service, secrets } = createFixture()
    service.save(channelInput())
    secrets.delete('secret_id-1' as SecretRef)

    expect(() => service.resolve('ch-deepseek')).toThrow(/密钥/)
  })
})
