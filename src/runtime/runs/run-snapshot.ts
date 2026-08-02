import type {
  CapabilitySnapshot,
  RunUsageLedger,
} from '../../shared/contracts/run-snapshot.ts'
import type { AgentInvocation } from './agent-engine.ts'

export type { RunUsageLedger } from '../../shared/contracts/run-snapshot.ts'

/** 轮次用量的结构形状（与 pi Usage 字段一致，但不依赖 pi 类型）。 */
export interface TurnUsageInput {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: { total?: number }
}

export const EMPTY_USAGE_LEDGER: RunUsageLedger = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

/** 把一轮模型调用的用量并入 Run 分类账本。 */
export function mergeUsageLedger(
  current: RunUsageLedger,
  turn: TurnUsageInput,
): RunUsageLedger {
  return {
    inputTokens: current.inputTokens + (turn.input ?? 0),
    outputTokens: current.outputTokens + (turn.output ?? 0),
    cacheReadTokens: current.cacheReadTokens + (turn.cacheRead ?? 0),
    cacheWriteTokens: current.cacheWriteTokens + (turn.cacheWrite ?? 0),
    totalTokens: current.totalTokens + (turn.totalTokens ?? 0),
    costUsd: current.costUsd + (turn.cost?.total ?? 0),
  }
}

/**
 * 从 Run 启动时固化的 invocation 构建能力快照。
 * 只保存 ref/名称/摘要，不落任何敏感配置（密钥、系统提示词）。
 */
export function buildCapabilitySnapshot(
  invocation: AgentInvocation,
): CapabilitySnapshot {
  const mcpByServer = new Map<
    string,
    { serverId: string; name: string; tools: string[] }
  >()
  for (const tool of invocation.tools ?? []) {
    if (tool.category !== 'mcp' || !tool.owner) continue
    const entry = mcpByServer.get(tool.owner) ?? {
      serverId: tool.owner,
      name: tool.source,
      tools: [],
    }
    entry.tools.push(tool.id)
    mcpByServer.set(tool.owner, entry)
  }
  return {
    permission: {
      ...invocation.permissionCeiling,
      allowedToolIds: [...invocation.permissionCeiling.allowedToolIds],
    },
    ...(invocation.profile ? { profile: invocation.profile } : {}),
    channel: {
      id: invocation.channel.id,
      name: invocation.channel.name,
      modelId: invocation.modelId,
    },
    tools: (invocation.tools ?? []).map((tool) => ({
      id: tool.id,
      name: tool.name,
      category: tool.category,
      source: tool.source,
    })),
    skills: (invocation.skills ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      source: skill.source,
    })),
    mcp: [...mcpByServer.values()],
    usage: { ...EMPTY_USAGE_LEDGER },
  }
}
