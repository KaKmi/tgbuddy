import { describe, expect, test } from 'bun:test'
import type { ChannelModel } from '../../../src/shared/contracts/channel.ts'
import type {
  ProviderCatalog,
  ProviderDiscoveryResult,
} from '../../../src/runtime/channels/ports/provider-catalog.ts'

/**
 * fake adapter：验证 Runtime 层只依赖端口契约，
 * 不关心真实 HTTP / pi 实现。
 */
class FakeProviderCatalog implements ProviderCatalog {
  readonly #result: ProviderDiscoveryResult

  constructor(result: ProviderDiscoveryResult) {
    this.#result = result
  }

  discover(): Promise<ProviderDiscoveryResult> {
    return Promise.resolve(this.#result)
  }
}

const MODELS: ChannelModel[] = [
  { id: 'm1', name: '模型一', contextWindow: 128_000, maxTokens: 64_000 },
]

describe('ProviderCatalog 端口契约', () => {
  test('fake adapter 成功路径返回模型列表', async () => {
    const catalog = new FakeProviderCatalog({ ok: true, models: MODELS })
    const result = await catalog.discover({
      channel: {
        id: 'ch-1',
        name: '渠道',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: 'sk',
        models: [],
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.models).toEqual(MODELS)
  })

  test('fake adapter 失败路径返回稳定诊断码', async () => {
    const catalog = new FakeProviderCatalog({
      ok: false,
      code: 'timeout',
      message: '连接超时，请检查网络或端点地址',
    })
    const result = await catalog.discover({
      channel: {
        id: 'ch-1',
        name: '渠道',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: 'sk',
        models: [],
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('timeout')
    expect(result.message.length).toBeGreaterThan(0)
  })
})
