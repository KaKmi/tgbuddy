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
import type { CompactionSourceEntry } from '../shared/types/session.ts'
import type { Channel } from '../shared/types/channel.ts'
import { toKernelMessages } from '../shared/types/message.ts'
import { buildModels } from './pi/pi-models.ts'

const SUMMARY_MAX_CHARS = 16_000
const AUTO_THRESHOLD = 0.85
const RESCHEDULE_GAP = 0.05

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

export function shouldScheduleCompaction(
  usedTokens: number,
  contextWindow: number,
  deferredAtTokens?: number,
): boolean {
  if (contextWindow <= 0 || usedTokens < contextWindow * AUTO_THRESHOLD) return false
  if (deferredAtTokens === undefined) return true
  return usedTokens >= deferredAtTokens + contextWindow * RESCHEDULE_GAP
}

/** 每次调用模型前使用估算值兜底，避免下一轮请求先撞上上下文上限。 */
export function shouldCompactBeforeModelCall(
  messagesTokens: number,
  fixedTokens: number,
  contextWindow: number,
): boolean {
  if (contextWindow <= 0) return false
  return messagesTokens + fixedTokens >= contextWindow * AUTO_THRESHOLD
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
