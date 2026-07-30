/**
 * 渠道预设 —— 常用端点的开箱配置。
 *
 * ★ 这些 compat 值不是猜的，来自 pi 自己维护的模型目录：
 *   node_modules/@earendil-works/pi-ai/dist/providers/data/{provider}.json
 *
 *   接任何新端点时，**先去那个目录看有没有现成的**。pi 为 36 家 provider
 *   维护了 compat 矩阵，自己一个个试要花几小时。
 *
 * 我们不直接用 pi 的 `deepseekProvider()` 工厂，是因为：
 *   1. 用户的渠道可能指向中转网关，baseUrl 和官方不一样
 *   2. 它的 auth 走 DEEPSEEK_API_KEY 环境变量，而 GUI 启动的 Electron
 *      读不到 shell 环境变量（见 kernel/pi/pi-models.ts 的说明）
 *   3. 引入内置 provider 会把它的模型目录一起拖进打包产物
 */

import type { Channel, ChannelModel } from './types/channel.ts'

/** DeepSeek 官方端点。注意 baseUrl 不带 /v1。 */
const DEEPSEEK_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: 'deepseek',
} as const

const DEEPSEEK_MODELS: ChannelModel[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    compat: DEEPSEEK_COMPAT,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
    compat: DEEPSEEK_COMPAT,
  },
]

/**
 * 建一个 DeepSeek 渠道。
 * @param apiKey  明文 key（落盘时必须加密，见 Channel.apiKey 的说明）
 * @param baseUrl 走中转网关时传自己的地址
 */
export function deepseekChannel(apiKey: string, baseUrl = 'https://api.deepseek.com'): Channel {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl,
    apiKey,
    models: DEEPSEEK_MODELS,
  }
}

// TODO(阶段 2): 智谱 / 通义 / 豆包 / MiniMax 的预设
//   对应 pi 目录里的 zai.json / alibaba.json / bytedance.json / minimax.json
