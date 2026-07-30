import type { Channel } from '../../shared/contracts/channel.ts'
import type { AgentEvent } from '../../shared/contracts/events.ts'

/**
 * 一次 Run 交给内核时的不可变快照。
 *
 * Runtime 只描述“要运行什么”，不接触 pi 的 Model、Session 或 Harness 类型。
 */
export interface AgentInvocation {
  sessionId: string
  text: string
  channel: Channel
  modelId: string
  systemPrompt: string
}

/**
 * Agent 内核端口。
 *
 * 高频增量只通过 AsyncIterable 返回；消息持久化由具体内核保证在
 * `message_end` 暴露前完成。
 */
export interface AgentEngine {
  run(invocation: AgentInvocation): AsyncIterable<AgentEvent>
  abort(sessionId: string): void
  dispose(): Promise<void>
}
