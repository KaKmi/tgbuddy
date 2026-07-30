import type { Channel } from '../../../shared/contracts/channel.ts'
import type { ContextUsage } from '../../../shared/contracts/context.ts'
import type { SessionMessage } from '../../../shared/contracts/message.ts'
import type { CompactionSourceEntry } from '../../../shared/contracts/session.ts'

export interface ContextCompactionInput {
  channel: Channel
  modelId: string
  entries: CompactionSourceEntry[]
}

export interface ContextCompactionResult {
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
  outputTokens: number
  costUsd: number
}

export interface PreparedContextCompaction {
  compactedCount: number
  contextWindow: number
  execute(signal: AbortSignal): Promise<ContextCompactionResult>
}

export interface ContextUsageEstimateInput {
  messages: SessionMessage[]
  previous?: ContextUsage
  contextWindow: number
  outputTokens: number
  costUsd: number
}

export interface ContextCompactor {
  prepare(input: ContextCompactionInput): PreparedContextCompaction
  estimateUsage(input: ContextUsageEstimateInput): ContextUsage
}
