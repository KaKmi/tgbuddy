import { describe, expect, test } from 'bun:test'
import type { Channel } from '../../../src/shared/contracts/channel.ts'
import {
  createPiProviderCatalog,
  type ModelListFetcher,
} from '../../../src/kernel/pi/pi-provider-catalog.ts'

function channel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-test',
    name: '测试渠道',
    protocol: 'openai',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    models: [],
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PiProviderCatalog', () => {
  test('成功发现模型并映射为 ChannelModel', async () => {
    let requestedUrl = ''
    const fetcher: ModelListFetcher = async (url, _init) => {
      requestedUrl = url
      return jsonResponse(200, {
        data: [
          { id: 'deepseek-v4-flash', object: 'model' },
          { id: 'deepseek-v4-pro', object: 'model' },
        ],
      })
    }
    const catalog = createPiProviderCatalog({ fetchImpl: fetcher })

    const result = await catalog.discover({ channel: channel() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ])
    expect(result.models[0]?.contextWindow).toBeGreaterThan(0)
    expect(requestedUrl).toBe('https://api.example.com/models')
  })

  test('认证失败映射为 auth_failed 可操作诊断', async () => {
    const fetcher: ModelListFetcher = async (_url, _init) =>
      jsonResponse(401, { error: { message: 'Invalid API key' } })
    const catalog = createPiProviderCatalog({ fetchImpl: fetcher })

    const result = await catalog.discover({ channel: channel() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('auth_failed')
    expect(result.message).toMatch(/密钥|认证/)
  })

  test('超时映射为 timeout 诊断', async () => {
    const fetcher: ModelListFetcher = async (_url, init) => {
      await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(init.signal.reason)
        })
      })
      throw new Error('unreachable')
    }
    const catalog = createPiProviderCatalog({
      fetchImpl: fetcher,
      timeoutMs: 10,
    })

    const result = await catalog.discover({ channel: channel() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('timeout')
  })

  test('空模型列表映射为 empty_models 诊断', async () => {
    const fetcher: ModelListFetcher = async (_url, _init) =>
      jsonResponse(200, { data: [] })
    const catalog = createPiProviderCatalog({ fetchImpl: fetcher })

    const result = await catalog.discover({ channel: channel() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('empty_models')
  })

  test('调用方取消映射为 canceled', async () => {
    const fetcher: ModelListFetcher = async (_url, init) => {
      if (init.signal.aborted) throw init.signal.reason
      await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
      throw new Error('unreachable')
    }
    const catalog = createPiProviderCatalog({ fetchImpl: fetcher })
    const controller = new AbortController()
    controller.abort(new DOMException('用户取消', 'AbortError'))

    const result = await catalog.discover({
      channel: channel(),
      signal: controller.signal,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('canceled')
  })

  test('网络失败映射为 network 诊断', async () => {
    const fetcher: ModelListFetcher = async () => {
      throw new TypeError('fetch failed')
    }
    const catalog = createPiProviderCatalog({ fetchImpl: fetcher })

    const result = await catalog.discover({ channel: channel() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('network')
  })

  test('Anthropic 协议返回暂不支持诊断', async () => {
    const fetcher: ModelListFetcher = async () => jsonResponse(200, { data: [] })
    const catalog = createPiProviderCatalog({ fetchImpl: fetcher })

    const result = await catalog.discover({
      channel: channel({ protocol: 'anthropic' }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('bad_config')
  })
})
