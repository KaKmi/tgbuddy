import type { ChannelModel } from '../../shared/contracts/channel.ts'
import type {
  ProviderCatalog,
  ProviderDiscoveryInput,
  ProviderDiscoveryResult,
} from '../../runtime/channels/ports/provider-catalog.ts'

/**
 * fetch 的最小形状：生产用全局 fetch，测试注入可控 fake。
 */
export interface ModelListFetcher {
  (
    url: string,
    init: {
      headers: Record<string, string>
      signal: AbortSignal
    },
  ): Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>
}

interface OpenAiModelListPayload {
  data?: Array<{ id?: unknown }>
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * 未知端点的保守默认规格：发现结果不携带 contextWindow/maxTokens，
 * 已知 preset 的精确规格会在 ChannelService 合并时保留。
 */
const DISCOVERY_DEFAULTS = {
  contextWindow: 128_000,
  maxTokens: 64_000,
} as const

/**
 * pi 内核的模型发现 adapter：对 OpenAI 兼容端点请求 `GET /models`，
 * 把结果翻译成 ChannelModel；错误统一映射为可操作诊断码。
 * Anthropic 协议当前没有自动发现，返回 bad_config 说明。
 */
export function createPiProviderCatalog(options: {
  fetchImpl?: ModelListFetcher
  timeoutMs?: number
} = {}): ProviderCatalog {
  const fetchImpl = options.fetchImpl ?? ((globalThis.fetch.bind(globalThis)) as ModelListFetcher)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async discover(input: ProviderDiscoveryInput): Promise<ProviderDiscoveryResult> {
      const { channel } = input
      if (channel.protocol !== 'openai') {
        return {
          ok: false,
          code: 'bad_config',
          message: '当前版本暂不支持 Anthropic 端点自动发现模型，请直接使用预设模型列表',
        }
      }
      if (!channel.apiKey) {
        return {
          ok: false,
          code: 'auth_failed',
          message: '该渠道还没有配置 API Key',
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new DOMException('连接超时', 'TimeoutError'))
      }, timeoutMs)
      const onExternalAbort = (): void => controller.abort(input.signal?.reason)
      if (input.signal?.aborted) {
        // 信号在调用前已取消：addEventListener 不会补发 abort，必须直接传播。
        controller.abort(input.signal.reason)
      } else {
        input.signal?.addEventListener('abort', onExternalAbort)
      }

      try {
        const response = await fetchImpl(`${stripTrailingSlash(channel.baseUrl)}/models`, {
          headers: {
            authorization: `Bearer ${channel.apiKey}`,
            accept: 'application/json',
          },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            code: 'auth_failed',
            message: '认证失败：请检查 API Key 是否正确、是否已过期',
          }
        }
        if (!response.ok) {
          return {
            ok: false,
            code: 'unknown',
            message: `端点返回 HTTP ${response.status}，请检查 Base URL 与端点协议`,
          }
        }
        const payload = (await response.json()) as OpenAiModelListPayload
        const models = (payload.data ?? [])
          .map((entry) => entry.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
          .map(toChannelModel)
        if (models.length === 0) {
          return {
            ok: false,
            code: 'empty_models',
            message: '连接成功，但端点没有返回任何模型',
          }
        }
        return { ok: true, models }
      } catch (error) {
        return mapDiscoveryError(error)
      } finally {
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', onExternalAbort)
      }
    },
  }
}

function toChannelModel(id: string): ChannelModel {
  return {
    id,
    name: id,
    contextWindow: DISCOVERY_DEFAULTS.contextWindow,
    maxTokens: DISCOVERY_DEFAULTS.maxTokens,
  }
}

function stripTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

function mapDiscoveryError(error: unknown): ProviderDiscoveryResult {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return {
      ok: false,
      code: 'timeout',
      message: '连接超时：请检查网络、Base URL 或端点可用性',
    }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { ok: false, code: 'canceled', message: '已取消模型发现' }
  }
  if (error instanceof TypeError) {
    return {
      ok: false,
      code: 'network',
      message: '网络请求失败：请检查地址可达性与网络连接',
    }
  }
  return {
    ok: false,
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }
}
