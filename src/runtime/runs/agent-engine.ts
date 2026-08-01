import type { Channel } from '../../shared/contracts/channel.ts'
import type { AgentEvent } from '../../shared/contracts/events.ts'
import type { SkillManifest } from '../../shared/contracts/skill.ts'
import type { RunProfileSnapshot } from '../../shared/contracts/run-snapshot.ts'
import type { ToolDescriptor } from '../../shared/contracts/tool.ts'
import type { AttachmentRef } from '../../shared/contracts/attachment.ts'
import type { RunLineage } from '../../shared/contracts/run.ts'

/**
 * 一次 Run 交给内核时的不可变快照。
 *
 * Runtime 只描述“要运行什么”，不接触 pi 的 Model、Session 或 Harness 类型。
 */
export interface AgentInvocation {
  sessionId: string
  text: string
  /** 本次 Run 绑定的工作区，S03 起用于创建 per-run ExecutionEnv */
  workspaceId: string
  /** 本次 Run 绑定的工作目录；工具只能使用这份不可变快照。 */
  cwd: string
  /** A02：用户消息携带的附件（字节已在 BlobStore，消息只存 ref） */
  attachments?: AttachmentRef[]
  /** D02：child run 的 lineage（父工具调用链接，用于区分 child 与工具注入门控） */
  lineage?: RunLineage
  /** D03：child run 的策略/授权归属会话（父会话）；root run 不设 */
  policySessionId?: string
  channel: Channel
  modelId: string
  systemPrompt: string
  /** C08：Run 启动时冻结的启用技能摘要，正文按需加载 */
  skills?: SkillManifest[]
  /** C12：Run 启动时冻结的工具快照（含 MCP），能力账本来源 */
  tools?: ToolDescriptor[]
  /** C12：本次 Run 使用的 Profile 摘要（不存敏感配置） */
  profile?: RunProfileSnapshot
  /**
   * 每次真正请求模型前执行的容量护栏。返回 true 表示历史已压缩，
   * kernel 需要重新读取持久化上下文。
   */
  beforeModelCall?(
    contextTokens: number,
    contextWindow: number,
  ): Promise<boolean>
}

export interface ToolPolicyInput {
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export type ToolPolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }

/**
 * 工具执行前的策略端口。
 *
 * K11 只接显式 permissive 实现，S05 再把真实 allow/ask/deny 规则装进来。
 */
export interface ToolPolicy {
  evaluate(
    input: ToolPolicyInput,
    signal: AbortSignal,
  ): Promise<ToolPolicyDecision>
}

export function createPermissiveToolPolicy(): ToolPolicy {
  return {
    evaluate: async () => ({ action: 'allow' }),
  }
}

/**
 * Agent 内核端口。
 *
 * 高频增量只通过 AsyncIterable 返回；消息持久化由具体内核保证在
 * `message_end` 暴露前完成。
 */
export interface AgentEngine {
  run(
    invocation: AgentInvocation,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent>
  dispose(): Promise<void>
}
