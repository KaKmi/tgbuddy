/**
 * 内核层 · 模型与渠道
 *
 * ⚠️ 这个目录（src/kernel/）是唯一允许 import pi 的地方。
 *    其它任何文件出现 `@earendil-works/pi-*` 都是架构违规。
 *
 *    这条规则用于避免内核 API 从 shared 一路渗透到 React 组件，
 *    保持 Provider 边界真实有效。
 */

import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type MutableModels,
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import type {
  Channel,
  ChannelModel,
  ChannelProtocol,
} from '../../shared/contracts/channel.ts'

/** 我们的协议名 → pi 的 api 标识 */
const API_BY_PROTOCOL = {
  openai: 'openai-completions',
  anthropic: 'anthropic-messages',
} as const satisfies Record<ChannelProtocol, string>

/** 我们的协议名 → pi 的流式实现工厂（lazy，第一次请求时才加载对应 SDK） */
const STREAMS_BY_PROTOCOL: Record<ChannelProtocol, () => ReturnType<typeof openAICompletionsApi>> = {
  openai: openAICompletionsApi,
  anthropic: anthropicMessagesApi,
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** 把一个渠道模型翻译成 pi 的 Model。注意 baseUrl 挂在 Model 上，不是 Provider 上。 */
function toPiModel(channel: Channel, m: ChannelModel): Model<Api> {
  return {
    id: m.id,
    name: m.name,
    api: API_BY_PROTOCOL[channel.protocol],
    provider: channel.id,
    baseUrl: channel.baseUrl,
    reasoning: m.reasoning ?? false,
    input: ['text'],
    cost: m.cost ?? ZERO_COST,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    ...(m.compat ? { compat: m.compat } : {}),
  } as Model<Api>
}

/**
 * 用一组渠道构建 pi 的 Models 集合。
 *
 * 关键点：我们**不注册 pi 内置的任何 provider**。所有模型都来自用户配置的渠道，
 * 这样打包时不会把 36 家 provider 的目录和 SDK 全都拖进产物。
 */
export function buildModels(channels: Channel[]): MutableModels {
  const models = createModels()

  for (const channel of channels) {
    if (channel.models.length === 0) continue

    models.setProvider(
      createProvider({
        id: channel.id,
        name: channel.name,
        auth: {
          apiKey: {
            name: `${channel.name} API Key`,
            // 我们自己管凭据（加密存在配置文件里），不走 pi 的凭据存储，
            // 也不依赖环境变量——GUI 启动的 Electron 拿不到 shell 的环境变量。
            // 压缩摘要直接调用 Models.completeSimple，不经过 Agent.getApiKey，
            // 所以 provider 自身也必须能解析到同一个 key。
            resolve: async () => ({ auth: { apiKey: channel.apiKey }, source: 'TgBuddy 渠道配置' }),
          },
        },
        models: channel.models.map((m) => toPiModel(channel, m)),
        api: STREAMS_BY_PROTOCOL[channel.protocol](),
      }),
    )
  }

  return models
}

/** 从已构建的 Models 里取一个模型。找不到返回 undefined。 */
export function resolveModel(
  models: MutableModels,
  channelId: string,
  modelId: string,
): Model<Api> | undefined {
  return models.getModel(channelId, modelId)
}

// TODO(阶段 4): 渠道连通性测试 —— 发一条最小请求，返回可用模型列表
// TODO(阶段 4): apiKey 使用 Electron safeStorage 加解密
