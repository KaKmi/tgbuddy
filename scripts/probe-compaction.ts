/** 直接验证压缩摘要调用，因为它不经过普通 Agent.getApiKey 鉴权链。 */

import { generateSummaryWithUsage } from '@earendil-works/pi-agent-core'
import { buildModels } from '../src/kernel/pi/pi-models.ts'
import { listChannels } from '../src/main/channel-store.ts'

const channels = listChannels()
const channel = channels[0]
const modelId = channel?.models[0]?.id
if (!channel || !modelId) throw new Error('没有可用渠道或模型')

const models = buildModels(channels)
const model = models.getModel(channel.id, modelId)
if (!model) throw new Error(`模型未注册：${channel.id}/${modelId}`)

const result = await generateSummaryWithUsage(
  [
    {
      role: 'user',
      content: [{ type: 'text', text: '请把项目日志整理成简短周报，并保留验证结果。' }],
      timestamp: Date.now(),
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: '已完成类型检查和测试，下一步生成周报。' }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    },
  ],
  models,
  model,
  1_024,
)

if (!result.ok) throw result.error
console.log(`压缩摘要调用成功：${result.value.text.length} 字符，${result.value.usage.totalTokens} tokens`)
