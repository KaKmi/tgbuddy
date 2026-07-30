/** 内核层 · 把线性 JSONL 历史适配给 pi 的压缩纯函数。 */

import {
  compact,
  convertToLlm,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  type AgentMessage,
  type CompactionPreparation,
  type Result,
  type SessionTreeEntry,
} from '@earendil-works/pi-agent-core'
import type { Api, Message, Model, Models } from '@earendil-works/pi-ai'
import type {
  ContextCompactionInput,
  ContextCompactor,
  ContextUsageEstimateInput,
  PreparedContextCompaction,
} from '../../runtime/context/ports/context-compactor.ts'
import type { Channel } from '../../shared/contracts/channel.ts'
import { toKernelMessages } from '../../shared/contracts/message.ts'
import type { CompactionSourceEntry } from '../../shared/contracts/session.ts'
import { buildPostCompactionUsage } from './pi-context-usage.ts'
import { buildModels } from './pi-models.ts'

const SUMMARY_MAX_CHARS = 16_000

export interface StoredCompactionResult {
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  usage?: import('@earendil-works/pi-ai').Usage
}

export interface CompactionKernelRuntime {
  models: Models
  model: Model<Api>
  preparation: CompactionPreparation
}

/**
 * Runtime 只持有压缩端口；pi 的模型注册表、Preparation 和 Usage 都封装在本适配器内。
 */
export function createPiContextCompactor(): ContextCompactor {
  return {
    prepare(input: ContextCompactionInput): PreparedContextCompaction {
      const runtime = prepareCompactionRuntime(
        [input.channel],
        input.channel.id,
        input.modelId,
        input.entries,
      )
      if (!runtime.ok) throw runtime.error

      return {
        compactedCount:
          runtime.value.preparation.messagesToSummarize.length
          + runtime.value.preparation.turnPrefixMessages.length,
        contextWindow: runtime.value.model.contextWindow,
        async execute(signal) {
          const result = await compactPreparedContext(
            runtime.value.preparation,
            runtime.value.models,
            runtime.value.model,
            signal,
          )
          if (!result.ok) throw result.error
          return {
            summary: result.value.summary,
            firstKeptEntryId: result.value.firstKeptEntryId,
            tokensBefore: result.value.tokensBefore,
            outputTokens: result.value.usage?.output ?? 0,
            costUsd: result.value.usage?.cost.total ?? 0,
          }
        },
      }
    },
    estimateUsage(input: ContextUsageEstimateInput) {
      return buildPostCompactionUsage(
        toKernelMessages(input.messages),
        input.previous,
        input.contextWindow,
        input.outputTokens,
        input.costUsd,
      )
    },
  }
}

/**
 * 供应商 usage 已经包含系统提示词和工具定义，不能再把固定部分重复相加。
 * 压缩后的保留消息仍带着压缩前 usage，此时改用逐条估算，避免立即重复压缩。
 */
export function estimateModelCallContextTokens(
  messages: AgentMessage[],
  fixedTokens: number,
): number {
  const lastCompaction = messages.findLast(
    (message): message is Extract<AgentMessage, { role: 'compactionSummary' }> =>
      message.role === 'compactionSummary',
  )
  if (lastCompaction) {
    const hasFreshUsage = messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.timestamp >= lastCompaction.timestamp &&
        message.stopReason !== 'aborted' &&
        message.stopReason !== 'error' &&
        message.usage.totalTokens > 0,
    )
    if (!hasFreshUsage) {
      return fixedTokens + messages.reduce((sum, message) => sum + estimateTokens(message), 0)
    }
  }
  const estimated = estimateContextTokens(messages)
  return estimated.usageTokens > 0 ? estimated.tokens : fixedTokens + estimated.tokens
}

/** Agent 默认转换器会丢掉 compactionSummary，续接时必须换成 harness 的转换器。 */
export function convertStoredMessagesToLlm(messages: AgentMessage[]): Message[] {
  return convertToLlm(messages)
}

export function prepareStoredCompaction(
  entries: CompactionSourceEntry[],
): Result<CompactionPreparation, Error> {
  const prepared = prepareCompaction(toPiEntries(entries), DEFAULT_COMPACTION_SETTINGS)
  if (!prepared.ok) return prepared
  if (!prepared.value) return { ok: false, error: new Error('没有可压缩的历史消息') }
  if (
    prepared.value.messagesToSummarize.length === 0 &&
    prepared.value.turnPrefixMessages.length === 0
  ) {
    return { ok: false, error: new Error('上下文还很短，没有可压缩的历史消息') }
  }
  return { ok: true, value: prepared.value }
}

export function prepareCompactionRuntime(
  channels: Channel[],
  channelId: string,
  modelId: string,
  entries: CompactionSourceEntry[],
): Result<CompactionKernelRuntime, Error> {
  const models = buildModels(channels)
  const model = models.getModel(channelId, modelId)
  if (!model) return { ok: false, error: new Error(`模型未注册：${channelId}/${modelId}`) }
  const preparation = prepareStoredCompaction(entries)
  if (!preparation.ok) return preparation
  return { ok: true, value: { models, model, preparation: preparation.value } }
}

export async function compactStoredContext(
  entries: CompactionSourceEntry[],
  models: Models,
  model: Model<Api>,
  signal?: AbortSignal,
): Promise<Result<StoredCompactionResult, Error>> {
  const prepared = prepareStoredCompaction(entries)
  if (!prepared.ok) return prepared

  return compactPreparedContext(prepared.value, models, model, signal)
}

export async function compactPreparedContext(
  preparation: CompactionPreparation,
  models: Models,
  model: Model<Api>,
  signal?: AbortSignal,
): Promise<Result<StoredCompactionResult, Error>> {
  const result = await compact(preparation, models, model, undefined, signal)
  if (!result.ok) return result
  if (!result.value.firstKeptEntryId) {
    return { ok: false, error: new Error('压缩结果缺少保留边界') }
  }

  return {
    ok: true,
    value: {
      summary: result.value.summary.slice(0, SUMMARY_MAX_CHARS),
      firstKeptEntryId: result.value.firstKeptEntryId,
      tokensBefore: result.value.tokensBefore,
      ...(result.value.usage ? { usage: result.value.usage } : {}),
    },
  }
}

export function toPiEntries(entries: CompactionSourceEntry[]): SessionTreeEntry[] {
  let parentId: string | null = null
  return entries.map((entry) => {
    const base = {
      id: entry.id,
      parentId,
      timestamp: new Date(entry.timestamp).toISOString(),
    }
    parentId = entry.id

    if (entry.type === 'compaction') {
      return {
        ...base,
        type: 'compaction',
        summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId,
        tokensBefore: entry.tokensBefore,
      } satisfies SessionTreeEntry
    }

    return {
      ...base,
      type: 'message',
      message: toKernelMessages([entry.message])[0]!,
    } satisfies SessionTreeEntry
  })
}
