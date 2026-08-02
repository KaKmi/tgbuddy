import type { Channel } from '../../shared/contracts/channel.ts'
import type { TitleGenerator } from '../../runtime/sessions/ports/title-generator.ts'
import { buildModels } from './pi-models.ts'

interface CreatePiTitleGeneratorOptions {
  resolveChannel(channelId?: string): Channel | undefined
}

/** 只负责一次无工具的短模型调用；标题业务规则留在 Runtime。 */
export function createPiTitleGenerator(
  options: CreatePiTitleGeneratorOptions,
): TitleGenerator {
  return {
    async generate(input) {
      const channel = options.resolveChannel(input.channelId)
      if (!channel) return null
      const modelId = input.modelId || channel.models[0]?.id
      if (!modelId) return null
      const models = buildModels([channel])
      const model = models.getModel(channel.id, modelId)
      if (!model) return null

      const message = await models.completeSimple(
        model,
        {
          systemPrompt: [
            '你为桌面 Agent 会话生成简短标题。',
            '只输出标题，不要解释、引号、Markdown 或句号。',
            '中文不超过 24 个字符，英文不超过 60 个字符。',
          ].join('\n'),
          messages: [{
            role: 'user',
            content: `[TGBUDDY_SESSION_TITLE]\n${input.userMessage}`,
            timestamp: Date.now(),
          }],
        },
        {
          signal: input.signal,
          maxTokens: 80,
          temperature: 0.2,
        },
      )
      if (message.stopReason === 'error' || message.stopReason === 'aborted') return null
      return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim() || null
    },
  }
}
