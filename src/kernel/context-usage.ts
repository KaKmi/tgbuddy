/**
 * 内核层 · 上下文用量统计。
 *
 * 供应商只回报整次请求的 token 总量，不回报系统提示词、工具定义、消息各占多少。
 * 因此合计使用供应商数据，分类沿用 pi 压缩模块的保守字符估算法，再把误差归入对话消息。
 */

import { estimateContextTokens } from '@earendil-works/pi-agent-core'
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

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateToolTokens(tools: ContextToolDefinition[]): number {
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
