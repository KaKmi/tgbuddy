/**
 * 事件与传输层。
 *
 * ## 双通道设计
 *
 * IPC 上跑两条正交的流：
 *   - `agent` —— 内核说的话（文字、思考、工具调用）
 *   - `host`  —— 宿主自己的事件（权限、模式变更、重试、标题）
 *
 * 换内核时只需要动 `agent` 那一半，`host` 整条链路零改动。
 */

import type { StopReason, Usage } from '@earendil-works/pi-ai'
import type { SessionMessage, ToolDetails } from './message.ts'

// ── 内核事件 ──────────────────────────────────────────────────────

export type AgentEvent =
  /** 一次 run 开始 */
  | { type: 'run_start' }
  /** 一轮（一次 LLM 调用 + 工具执行）开始 */
  | { type: 'turn_start' }
  /** 流式文本增量 */
  | { type: 'text_delta'; delta: string }
  /** 流式思考增量 */
  | { type: 'thinking_delta'; delta: string }
  /** 一条消息完成，可直接落盘 */
  | { type: 'message_end'; message: SessionMessage }
  /**
   * 工具开始 —— ★ 注意这个事件比权限询问早约 5ms（阶段 1 实测）。
   * UI 不能直接据此渲染「执行中」，必须先查待授权队列。
   * 详见 docs/01-架构设计.md 6.2。
   */
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  /** 工具执行中的进度（pi 的 onUpdate 回调） */
  | { type: 'tool_progress'; toolCallId: string; partial: unknown }
  | { type: 'tool_end'; toolCallId: string; isError: boolean; details?: ToolDetails }
  /** 一轮结束，带本轮用量 */
  | { type: 'turn_end'; usage?: Usage }
  /** 整个 run 结束 */
  | { type: 'run_end'; stopReason: StopReason }
  /**
   * ★ 内核错误。
   *
   * pi 的契约：stream 永远不 throw，所有失败都编码成事件。
   * 阶段 1 踩过这个坑——没订阅这个分支时，认证失败会静默地表现为
   * 「模型不说话」，界面上没有任何错误提示。这条必须一路送到 UI。
   */
  | { type: 'error'; reason: 'error' | 'aborted'; message: string }

// ── 宿主事件 ──────────────────────────────────────────────────────

// 权限相关的类型统一在 types/permission.ts，这里只做转发，避免两处定义漂移
import type { AskUserRequest, PermissionRequest, PlanRequest } from './permission.ts'
export type {
  AskUserRequest,
  AskUserResponse,
  PermissionRequest,
  PermissionResponse,
  PlanRequest,
  PlanResponse,
} from './permission.ts'

export type HostEvent =
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; allowed: boolean }
  | { type: 'mode_changed'; mode: 'plan' | 'auto' | 'bypass'; source: 'user' | 'tool' }
  | { type: 'plan_request'; request: PlanRequest }
  | { type: 'plan_resolved'; requestId: string; approved: boolean }
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  /** 一次运行结束时统一清掉可能残留的授权和计划卡片 */
  | { type: 'pending_requests_cleared' }
  | { type: 'expert_changed'; expertId: string; expertName: string }
  | { type: 'compaction_start' }
  | { type: 'compaction_end'; summary: string; compactedCount: number }
  | { type: 'retry'; attempt: number; maxAttempts: number; reason: string }
  | { type: 'title_updated'; title: string }
  /** 宿主侧错误（渠道配置、文件读写、MCP 连接失败等） */
  | { type: 'host_error'; message: string; recoverable: boolean }

// ── 传输载荷 ──────────────────────────────────────────────────────

export type StreamPayload =
  | {
      channel: 'agent'
      event: AgentEvent
      /** 子 Agent 的事件带上父工具调用 id，UI 据此做嵌套分组 */
      parentToolCallId?: string
    }
  | { channel: 'host'; event: HostEvent }

/** 主进程推给渲染进程的流式帧 */
export interface StreamFrame {
  sessionId: string
  /** 用于丢弃旧流的迟到事件 */
  runId: number
  payload: StreamPayload
}
