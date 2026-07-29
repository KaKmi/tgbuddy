/**
 * 内核层 · 事件收敛
 *
 * 消息不做翻译（见 shared/types/message.ts 的说明，pi 的 Message 原样存），
 * 但**事件要收敛**。这是两个不同的理由：
 *
 *   - 消息不翻译 —— 因为它落盘，翻译的往返无损风险大于收益
 *   - 事件要收敛 —— 因为它瞬时、不落盘，单向转换零风险，而收益很实在：
 *       ① pi 有 10 个事件，UI 只关心其中 6 个
 *       ② `message_update` 里还套了一层 `assistantMessageEvent`，摊平后 UI 少写一堆分支
 *       ③ 可以在这里补 pi 没有的语义（比如从 details 里抽出 ToolDetails）
 *
 * ## 事件映射表
 *
 * | pi 事件 | 我们的事件 |
 * |---|---|
 * | `agent_start` | `run_start` |
 * | `turn_start` | `turn_start` |
 * | `message_update` + `text_delta` | `text_delta` |
 * | `message_update` + `thinking_delta` | `thinking_delta` |
 * | `message_update` + `error` | **`error`** ← 阶段 1 踩过坑，不能漏 |
 * | `message_end` | `message_end`（装进信封） |
 * | `tool_execution_start` | `tool_start` |
 * | `tool_execution_update` | `tool_progress` |
 * | `tool_execution_end` | `tool_end` |
 * | `turn_end` | `turn_end`（带 usage） |
 * | `agent_end` | `run_end` |
 * | `message_start` | *（丢弃，我们用 message_end 落盘）* |
 */

import type { AgentEvent as PiAgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage as PiAssistant, Message as PiMessage } from '@earendil-works/pi-ai'
import type { AgentEvent } from '../shared/types/event.ts'
import type { ToolDetails } from '../shared/types/message.ts'

/**
 * pi 事件 → 我们的事件。返回 null 表示这条不需要往上送。
 *
 * ★ 两个必须处理的点：
 *   1. `message_update` 里嵌套的 `assistantMessageEvent.type === 'error'`
 *      —— pi 的 stream 永远不 throw，失败全编码成这个事件。漏了会导致
 *         认证失败在界面上表现为"模型不说话"，没有任何提示（阶段 1 实测踩过）
 *   2. `message_end` 要装进信封并配上我们的 id，让上层直接拿到可落盘的东西
 *
 * @param nextId 生成 8 位 hex，与会话树 entry id 一致
 */
export function eventFromPi(e: PiAgentEvent, nextId: () => string): AgentEvent | null {
  switch (e.type) {
    case 'agent_start':
      return { type: 'run_start' }

    case 'turn_start':
      return { type: 'turn_start' }

    case 'message_update': {
      const inner = e.assistantMessageEvent
      if (inner.type === 'text_delta') return { type: 'text_delta', delta: inner.delta }
      if (inner.type === 'thinking_delta') return { type: 'thinking_delta', delta: inner.delta }
      if (inner.type === 'error') {
        return { type: 'error', reason: inner.reason, message: inner.error.errorMessage ?? '未知错误' }
      }
      return null // start / end 之类的子事件我们不用
    }

    case 'message_end':
      return {
        type: 'message_end',
        message: {
          kind: 'kernel',
          id: nextId(),
          createdAt: (e.message as PiMessage).timestamp,
          message: e.message as PiMessage,
        },
      }

    case 'tool_execution_start':
      return { type: 'tool_start', toolCallId: e.toolCallId, toolName: e.toolName, args: e.args }

    case 'tool_execution_update':
      return { type: 'tool_progress', toolCallId: e.toolCallId, partial: e.partialResult }

    case 'tool_execution_end':
      return {
        type: 'tool_end',
        toolCallId: e.toolCallId,
        isError: e.isError,
        ...(extractDetails(e.result) ? { details: extractDetails(e.result)! } : {}),
      }

    case 'turn_end': {
      const msg = e.message
      const usage = msg.role === 'assistant' ? (msg as PiAssistant).usage : undefined
      return { type: 'turn_end', ...(usage ? { usage } : {}) }
    }

    case 'agent_end':
      // TODO(你来实现): pi 的 agent_end 不带 stopReason，
      //   要从 e.messages 里最后一条 assistant 消息取。注意可能一条都没有。
      return { type: 'run_end', stopReason: 'stop' }

    default:
      return null
  }
}

/**
 * 从工具结果里抽出我们约定的 ToolDetails。
 *
 * 工具是我们自己写的，理论上一定符合约定；但 MCP 提供的工具不受我们控制，
 * 所以这里要宽容——拿不到就返回 undefined，不要抛。
 */
function extractDetails(result: unknown): ToolDetails | undefined {
  if (!result || typeof result !== 'object') return undefined
  const details = (result as { details?: unknown }).details
  if (!details || typeof details !== 'object') return undefined
  return details as ToolDetails
}
