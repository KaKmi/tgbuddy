import type { ToolCategory } from './tool.ts'
import type { SkillSource } from './skill.ts'

/** Run 启动时固化的模型选择（不存密钥/系统提示词等敏感配置）。 */
export interface RunProfileSnapshot {
  id: string
  name: string
  channelId: string
  modelId: string
}

export interface RunToolSnapshot {
  id: string
  name: string
  category: ToolCategory
  source: string
}

export interface RunSkillSnapshot {
  id: string
  name: string
  source: SkillSource
}

export interface RunMcpSnapshot {
  serverId: string
  name: string
  tools: string[]
}

/** 分类 token/cost 账本：按模型调用逐轮相加。 */
export interface RunUsageLedger {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
}

/** 每个 Run 持久化的能力快照：Profile/模型/工具/Skill/MCP + 账本。 */
export interface CapabilitySnapshot {
  profile?: RunProfileSnapshot
  channel: { id: string; name: string; modelId: string }
  tools: RunToolSnapshot[]
  skills: RunSkillSnapshot[]
  mcp: RunMcpSnapshot[]
  usage: RunUsageLedger
}

export type RunRecordStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'interrupted'

/** 每个 Run 的持久化记录：能力快照 + 分类 token/cost 账本。 */
export interface RunRecord {
  id: string
  sessionId: string
  /** D01：lineage（child run 归属的 root / 父工具调用） */
  workspaceId?: string
  rootRunId?: string
  agentRunId?: string
  parentToolCallId?: string
  createdAt: number
  settledAt?: number
  status: RunRecordStatus
  snapshot?: CapabilitySnapshot
  error?: string
}
