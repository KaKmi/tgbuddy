/**
 * IPC 契约 —— 通道名常量与 preload 暴露的 API 形状。
 *
 * 加一个新通道要同步改四个地方：
 *   1. 这里加常量和类型
 *   2. main/ipc.ts 注册 handler
 *   3. preload/index.ts 暴露方法
 *   4. renderer 的 atoms 里调用
 *
 * 四处不同步是这类架构最常见的 bug 来源，所以类型定义集中放这里，
 * 让 TypeScript 帮忙对齐。
 */

import type { StreamFrame } from './types/event.ts'
import type { SessionMessage } from './types/message.ts'
import type { Channel } from './types/channel.ts'
import type { ContextUsage } from './types/context.ts'
import type {
  AskUserRequest,
  AskUserResponse,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  PlanRequest,
  PlanResponse,
} from './types/permission.ts'

// ── 通道名 ────────────────────────────────────────────────────────

export const IPC = {
  // 会话
  SESSION_LIST: 'session:list',
  SESSION_CREATE: 'session:create',
  SESSION_DELETE: 'session:delete',
  SESSION_MESSAGES: 'session:messages',
  SESSION_COMPACTED_MESSAGES: 'session:compacted-messages',
  SESSION_UPDATE_META: 'session:update-meta',

  // Agent 运行
  AGENT_SEND: 'agent:send',
  AGENT_STOP: 'agent:stop',
  /** 主 → 渲染，单向推送 */
  AGENT_STREAM: 'agent:stream',

  // 权限
  PERMISSION_RESPOND: 'permission:respond',
  /** 渲染进程重载后捞回挂起的请求 */
  PERMISSION_PENDING: 'permission:pending',

  // 计划模式
  PLAN_RESPOND: 'plan:respond',
  PLAN_PENDING: 'plan:pending',
  MODE_SET: 'mode:set',

  // 上下文压缩
  COMPACTION_START: 'compaction:start',
  COMPACTION_DEFER: 'compaction:defer',
  COMPACTION_CANCEL: 'compaction:cancel',

  // 用户问答
  ASK_USER_RESPOND: 'ask-user:respond',
  ASK_USER_PENDING: 'ask-user:pending',

  // 渠道
  CHANNEL_LIST: 'channel:list',
  CHANNEL_SAVE: 'channel:save',
  CHANNEL_DELETE: 'channel:delete',
  CHANNEL_TEST: 'channel:test',
} as const

// ── 请求/响应类型 ─────────────────────────────────────────────────

/**
 * 会话元数据 —— **侧边栏渲染只依赖这个对象，不读 JSONL**。
 *
 * 这是索引/JSONL 两层分离的意义所在：列出 200 个会话不能去读 200 个大文件。
 * 所以凡是侧边栏要显示的东西，都必须冗余存在这里。
 */
export interface SessionMeta {
  id: string
  title: string

  /** 工作区隔离。会话、技能、权限规则的默认作用域都跟着它走 */
  workspaceId?: string

  channelId?: string
  modelId?: string
  expertId?: string

  pinned?: boolean
  archived?: boolean

  /** 权限模式。跟着会话走，重启后保持 */
  permissionMode?: PermissionMode

  /** 最后一次运行的结果，决定侧边栏那行状态文案 */
  status?: 'idle' | 'running' | 'done' | 'failed'
  /** status 为 failed 时的原因摘要，如「连接器超时」 */
  statusDetail?: string
  /**
   * 最近活动的一句话摘要，如「正在写 reports/q2-risk…」。
   * 运行中实时更新，结束后保留最后一条。
   */
  lastActivity?: string
  /** 产物数量，用于「N 个产物」。阶段 4 有了工具才会非零 */
  artifactCount?: number

  /** 最近一次模型调用后的上下文占用，供侧边栏和输入区直接展示 */
  contextUsage?: ContextUsage

  /** 从别的会话派生而来 —— 扁平引用，不成树（见 docs/06 决定 5） */
  originRef?: { sessionId: string; messageId: string }

  createdAt: number
  updatedAt: number
}

export interface SendInput {
  sessionId: string
  text: string
  /** 显式调用的技能名（用户点了 /skill:xxx） */
  invokeSkill?: string
}

export type { PermissionRequest, PermissionResponse } from './types/permission.ts'

// ── preload 暴露给渲染进程的 API ──────────────────────────────────

export interface TgBuddyAPI {
  session: {
    list(): Promise<SessionMeta[]>
    create(input: { title?: string; channelId?: string; modelId?: string }): Promise<SessionMeta>
    delete(id: string): Promise<void>
    messages(id: string): Promise<SessionMessage[]>
    compactedMessages(id: string, compactionId: string): Promise<SessionMessage[]>
    updateMeta(id: string, patch: Partial<SessionMeta>): Promise<void>
  }
  agent: {
    send(input: SendInput): Promise<void>
    stop(sessionId: string): Promise<void>
    /** 订阅流式帧，返回取消订阅函数 */
    onStream(listener: (frame: StreamFrame) => void): () => void
  }
  permission: {
    respond(res: PermissionResponse): Promise<void>
    pending(): Promise<PermissionRequest[]>
  }
  plan: {
    respond(res: PlanResponse): Promise<void>
    pending(): Promise<PlanRequest[]>
    /** 用户手动切换权限模式 */
    setMode(sessionId: string, mode: PermissionMode): Promise<void>
  }
  askUser: {
    respond(res: AskUserResponse): Promise<void>
    pending(): Promise<AskUserRequest[]>
  }
  compaction: {
    start(sessionId: string): Promise<void>
    defer(sessionId: string): Promise<void>
    cancel(sessionId: string): Promise<void>
  }
  channel: {
    list(): Promise<Channel[]>
    save(channel: Channel): Promise<void>
    delete(id: string): Promise<void>
    test(id: string): Promise<{ success: boolean; message: string }>
  }
}

declare global {
  interface Window {
    tgbuddy: TgBuddyAPI
  }
}
