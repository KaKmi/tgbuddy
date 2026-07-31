/**
 * 渠道公共契约（Channel）—— 用户配置的一个模型接入点。
 *
 * 一个渠道 = 一个 baseUrl + 一个 apiKey + 若干模型。
 * 这一层是我们自己的类型，不是 pi 的——kernel/pi/pi-models.ts 负责翻译成 pi 的 Provider/Model。
 */

import type { SecretRef } from './secret.ts'

/** 端点协议。pi 支持 9 种，我们精简版只接这两种，覆盖国内绝大多数网关。 */
export type ChannelProtocol = 'openai' | 'anthropic'

/**
 * 第三方端点兼容性开关，直接透传给 pi 的 `Model.compat`。
 *
 * 不设置时 pi 会按 baseUrl 做 URL 探测，但国内第三方网关经常探测不准，
 * 建议显式配置。这里只列出最常踩坑的几个，完整列表见 pi 的 `Model.compat`。
 */
export interface ChannelCompat {
  /** vLLM / Ollama / SGLang 以及 DeepSeek 等端点要 false */
  supportsDeveloperRole?: boolean
  /** 端点是否支持 OpenAI 的 store 参数。DeepSeek 要 false */
  supportsStore?: boolean
  /** 有些端点只认 max_tokens，不认 max_completion_tokens */
  maxTokensField?: 'max_completion_tokens' | 'max_tokens'
  /** 思考内容的组织格式，DeepSeek / 智谱 / 通义各不相同 */
  thinkingFormat?: 'openai' | 'deepseek' | 'zai' | 'qwen' | 'openrouter' | 'together'
  /** 回传 assistant 消息时是否必须带 reasoning_content 字段。DeepSeek 要 true */
  requiresReasoningContentOnAssistantMessages?: boolean
  /** 端点不支持 JSON Schema strict 模式时置 false */
  supportsStrictMode?: boolean
  /** 工具结果是否必须带 name 字段 */
  requiresToolResultName?: boolean
}

/** 渠道里的一个模型。价格单位是 $/百万 token。 */
export interface ChannelModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  /** 是否支持思考/推理 */
  reasoning?: boolean
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  compat?: ChannelCompat
}

export interface Channel {
  id: string
  name: string
  protocol: ChannelProtocol
  baseUrl: string
  /**
   * 保存时可选传入明文（设置页输入框）；任何 list 结果都不会携带明文。
   */
  apiKey?: string
  /** 已保存密钥的引用；有值表示该渠道已配置密钥 */
  secretRef?: SecretRef
  models: ChannelModel[]
}

/** 保存渠道的输入：新渠道可不带 id（由 Runtime 生成）。 */
export type ChannelSaveInput = Omit<Channel, 'id'> & { id?: string }
