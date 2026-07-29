/**
 * 内核层 · 上下文用量统计。
 *
 * 供应商只回报整次请求的 token 总量，不回报系统提示词、工具定义、消息各占多少。
 * 因此合计使用供应商数据，分类沿用 pi 压缩模块的保守字符估算法，再把误差归入对话消息。
 */

import { estimateContextTokens, estimateTokens } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Usage } from '@earendil-works/pi-ai'
import type { ContextUsage, ContextUsageBreakdown } from '../shared/types/context.ts'

export interface ContextToolDefinition {
  name: string
  description: string
  parameters: unknown
}

export interface ContextUsageInput {
  messages: AgentMessage[]
  systemPrompt: string
  tools: ContextToolDefinition[]
  contextWindow: number
  usage: Usage
  now?: number
}

export interface EstimatedContextUsageInput {
  messages: AgentMessage[]
  systemPrompt: string
  tools: ContextToolDefinition[]
  contextWindow: number
  outputTokens?: number
  costUsd?: number
  now?: number
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateToolTokens(tools: ContextToolDefinition[]): number {
  let chars = 0
  for (const tool of tools) {
    chars += JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }).length
  }
  return Math.ceil(chars / 4)
}

/** 已知分类若超过供应商总量，按比例收缩，保证条形图不会出现负数或超宽。 */
export function allocateContextBreakdown(
  usedTokens: number,
  systemPrompt: number,
  tools: number,
): ContextUsageBreakdown {
  const known = systemPrompt + tools
  if (known <= usedTokens) {
    return {
      systemPrompt,
      tools,
      messages: usedTokens - known,
      skills: 0,
      mcp: 0,
    }
  }

  if (known === 0) {
    return { systemPrompt: 0, tools: 0, messages: usedTokens, skills: 0, mcp: 0 }
  }

  const scaledSystem = Math.round((systemPrompt / known) * usedTokens)
  return {
    systemPrompt: scaledSystem,
    tools: usedTokens - scaledSystem,
    messages: 0,
    skills: 0,
    mcp: 0,
  }
}

export function buildContextUsage(input: ContextUsageInput): ContextUsage {
  const estimated = estimateContextTokens(input.messages)
  const reported = input.usage.totalTokens || estimated.tokens
  const usedTokens = Math.max(0, reported)
  const contextWindow = Math.max(0, input.contextWindow)

  return {
    usedTokens,
    contextWindow,
    percent:
      contextWindow > 0 ? Math.round((usedTokens / contextWindow) * 1_000) / 10 : 0,
    breakdown: allocateContextBreakdown(
      usedTokens,
      estimateTextTokens(input.systemPrompt),
      estimateToolTokens(input.tools),
    ),
    outputTokens: input.usage.output,
    costUsd: input.usage.cost.total,
    updatedAt: input.now ?? Date.now(),
  }
}

export function buildEstimatedContextUsage(input: EstimatedContextUsageInput): ContextUsage {
  const systemPrompt = estimateTextTokens(input.systemPrompt)
  const tools = estimateToolTokens(input.tools)
  const messages = estimateContextTokens(input.messages).tokens
  const usedTokens = systemPrompt + tools + messages
  const contextWindow = Math.max(0, input.contextWindow)

  return {
    usedTokens,
    contextWindow,
    percent:
      contextWindow > 0 ? Math.round((usedTokens / contextWindow) * 1_000) / 10 : 0,
    breakdown: { systemPrompt, tools, messages, skills: 0, mcp: 0 },
    outputTokens: input.outputTokens ?? 0,
    costUsd: input.costUsd ?? 0,
    updatedAt: input.now ?? Date.now(),
  }
}

export function buildPostCompactionUsage(
  messages: AgentMessage[],
  previous: ContextUsage | undefined,
  contextWindow: number,
  outputTokens = 0,
  costUsd = 0,
): ContextUsage {
  // 保留消息里的 assistant.usage 仍指向压缩前的请求，不能用于压缩后的即时统计。
  const messagesTokens = messages.reduce((sum, message) => sum + estimateTokens(message), 0)
  const stable = previous?.breakdown ?? {
    systemPrompt: 0,
    tools: 0,
    messages: 0,
    skills: 0,
    mcp: 0,
  }
  const usedTokens =
    stable.systemPrompt + stable.tools + stable.skills + stable.mcp + messagesTokens

  return {
    usedTokens,
    contextWindow,
    percent:
      contextWindow > 0 ? Math.round((usedTokens / contextWindow) * 1_000) / 10 : 0,
    breakdown: { ...stable, messages: messagesTokens },
    outputTokens,
    costUsd,
    updatedAt: Date.now(),
  }
}
