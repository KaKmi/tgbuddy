/**
 * 会话消息公共契约 —— 信封模式（不做翻译）。
 *
 * ## 为什么不做归一化翻译
 *
 * 曾经设计过一层完整的归一化（pi 的类型 ⇄ 我们的类型），后来砍掉了。理由：
 *
 * 1. **pi 的消息格式本身已经是中立格式**——不是 OpenAI/Anthropic 原生格式，
 *    各 provider 在 pi 内部做双向转换。再归一化一次是重复劳动
 * 2. **实测它很稳定**：0.79 → 0.82 三个 minor 里，`Message` / `ContentBlock` /
 *    `AgentEvent` / `AgentState` / `AgentTool` 一个字段都没改，
 *    破坏性变更全在 API 表面和 harness 层
 * 3. 本项目不打算换内核
 *
 * 翻译层的真实代价：往返必须无损（signature 丢了会导致续接失败），
 * 而这个方向的 bug 症状极隐蔽。收益撑不住这个代价。
 *
 * ## 但仍然需要一层信封
 *
 * 有三样东西 pi 不提供，必须由我们补：
 *   - **`id`** —— 会话树的 `id` / `parentId` 需要，pi 的 Message 只有 timestamp
 *   - **系统通知消息** —— 切换专家、压缩边界，pi 没有对应类型
 *   - **`ToolDetails` 约定** —— 结果区要消费，pi 的 `details` 是 `any`
 *
 * ## 版本护栏
 *
 * 会话文件头记 `kernel: 'pi@0.82'`。将来 pi 真改了消息结构时，
 * 迁移脚本靠这个字段判断在读什么格式。这是不做翻译换来的责任。
 */

import type { Message as PiMessage } from '@earendil-works/pi-ai'
import type {
  AgentMessage,
  SessionTreeEntry,
} from '@earendil-works/pi-agent-core'
import type { AttachmentRef } from './attachment.ts'
import type { BlobRef } from './blob.ts'

/** 当前内核标识，写进会话文件头 */
export const KERNEL_ID = 'pi@0.82' as const

// ── 工具结果的 details 约定 ────────────────────────────────────────

/**
 * ★ 所有会产生副作用的工具，`details` 必须遵守这个约定。
 *
 * pi 的 `AgentToolResult` 有两个通道：`content` 进 LLM 上下文，
 * `details` 是应用自定义、模型看不到的。结果区读的就是 `details`。
 *
 * 别让每个工具自己发明字段名。详见 docs/01-架构设计.md 6.5。
 */
export interface ToolDetails {
  /** 涉及的文件绝对路径。结果区靠这个收集产物 */
  path?: string
  /** 一次涉及多个文件时用这个 */
  paths?: string[]
  action?: 'create' | 'update' | 'delete' | 'read' | 'execute'
  bytes?: number
  /** A04：超长工具输出的完整内容 ref（BlobStore），消息只存 8 行预览 */
  outputRef?: BlobRef
  [key: string]: unknown
}

// ── 消息信封 ──────────────────────────────────────────────────────

interface EnvelopeBase {
  /** 8 位 hex，与会话树的 entry id 一致 */
  id: string
  createdAt: number
}

/** 内核消息 —— pi 的 Message 原样装在里面，零翻译 */
export interface KernelMessage extends EnvelopeBase {
  kind: 'kernel'
  message: PiMessage
  /** 本轮耗时，用于会话诊断。pi 不提供 */
  durationMs?: number
  /** A02：用户消息携带的附件 ref（历史回放时从 app_attachments join 还原） */
  attachments?: AttachmentRef[]
}

/**
 * 系统通知 —— 切换专家、进入计划模式、压缩边界。
 *
 * 对应 pi 会话格式里 `custom_message` 的语义：**进 LLM 上下文**
 * （所以模型知道"专家换了"），同时带 display 控制界面上显不显示。
 *
 * 回灌 pi 时转成一条 user 消息。
 *
 * （纯应用状态、不进上下文的东西走会话树的 `custom` entry，不是消息。）
 */
export interface NoticeMessage extends EnvelopeBase {
  kind: 'notice'
  notice: 'expert_changed' | 'mode_changed' | 'compaction' | 'session_resumed'
  /** 给模型看的文本 */
  text: string
  /** 是否在界面上显示 */
  display: boolean
}

/** 压缩边界。摘要进入模型上下文，原始消息仍保留在 JSONL 中。 */
export interface CompactionMessage extends EnvelopeBase {
  kind: 'compaction'
  summary: string
  compactedCount: number
  tokensBefore: number
  firstKeptEntryId: string
}

export type SessionMessage = KernelMessage | NoticeMessage | CompactionMessage

/**
 * pi Session backend 的原生 entry 类型。
 *
 * 这里只做 type alias，不复制字段、不做归一化翻译；Runtime port 因而能保持
 * 内核 entry 的 ID、parentId 和签名数据原样往返。
 */
export type PersistedSessionEntry = SessionTreeEntry

// ── 便利函数 ──────────────────────────────────────────────────────

/**
 * 会话消息 → pi 的 Message 数组，用于续接（`agent.state.messages = ...`）。
 *
 * 唯一的转换点，而且是单向的、无信息损失风险的。
 */
export function toKernelMessages(messages: SessionMessage[]): AgentMessage[] {
  return messages.map((m) => {
    if (m.kind === 'kernel') return m.message
    if (m.kind === 'compaction') {
      return {
        role: 'compactionSummary',
        summary: m.summary,
        tokensBefore: m.tokensBefore,
        timestamp: m.createdAt,
      } satisfies AgentMessage
    }
    return {
      role: 'user',
      content: [{ type: 'text', text: m.text }],
      timestamp: m.createdAt,
    } satisfies PiMessage
  })
}

/** 取一条消息的角色，UI 分发用 */
export function roleOf(
  m: SessionMessage,
): 'user' | 'assistant' | 'tool_result' | 'notice' | 'compaction' {
  if (m.kind === 'notice') return 'notice'
  if (m.kind === 'compaction') return 'compaction'
  return m.message.role === 'toolResult' ? 'tool_result' : m.message.role
}
