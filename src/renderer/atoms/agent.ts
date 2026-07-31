/**
 * Agent 状态 —— Jotai。
 *
 * 关键设计：**所有流式状态按 sessionId 隔离在 Map 里**，
 * 天然支持多会话并行流式，而且状态机与 IPC 解耦、易测。
 */

import { atom } from 'jotai'
import type { AgentEvent } from '../../shared/types/event.ts'
import type { SessionMeta, Workspace } from '../../shared/ipc.ts'
import type { Channel } from '../../shared/contracts/channel.ts'
import type { Profile } from '../../shared/contracts/profile.ts'
import type { SessionMessage } from '../../shared/types/message.ts'
import type {
  AskUserRequest,
  PermissionRequest,
  PlanRequest,
} from '../../shared/types/permission.ts'
import type { MarkerKind } from '../components/SystemMarker.tsx'

export interface ToolActivity {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  /**
   * ★ 四态。注意 `awaiting_permission` 必须优先于 `running` 显示 ——
   * pi 的 tool_execution_start 比权限询问早约 5ms（阶段 1 实测），
   * 直接按 running 渲染会让用户看到"正在执行 rm -rf"然后才弹授权框。
   * 详见 docs/01-架构设计.md 6.2。
   */
  status: 'awaiting_permission' | 'running' | 'success' | 'error' | 'denied'
  /** 开始时间，用于算耗时 */
  startedAt: number
  /** 执行耗时，tool_end 时填 */
  elapsedMs?: number
  /** 实时结果预览；完整内容在落盘的 toolResult 消息中。 */
  result?: { isError: boolean; text: string }
}

export interface StreamState {
  running: boolean
  /** 流式累积的正文 */
  text: string
  /** 流式累积的思考内容 */
  thinking: string
  toolActivities: ToolActivity[]
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  compaction?: {
    status: 'scheduled' | 'queued' | 'running'
    deadlineAt?: number
    compactedCount?: number
  }
  /** 内核错误，要显示给用户 —— 不显示的话认证失败看起来就是"模型不说话" */
  error?: string
}

export const emptyStreamState = (): StreamState => ({
  running: false,
  text: '',
  thinking: '',
  toolActivities: [],
})

// ── Atoms ─────────────────────────────────────────────────────────

export const sessionsAtom = atom<SessionMeta[]>([])
export const currentSessionIdAtom = atom<string | null>(null)
export const workspacesAtom = atom<Workspace[]>([])
/** Runtime 选择状态的镜像：权威状态在主进程 WorkspaceService，这里只驱动 UI。 */
export const currentWorkspaceIdAtom = atom<string | null>(null)
/** C02/C04：渠道与 Profile 的设置镜像（主进程是权威）。 */
export const channelsAtom = atom<Channel[]>([])
export const profilesAtom = atom<Profile[]>([])

/**
 * 输入区「模型」chip 的显示文本：Profile 名优先，其次会话直接指定的
 * 模型名，最后渠道首个模型；都没有时提示选择。
 */
export function resolveModelChipLabel(
  meta: Pick<SessionMeta, 'profileId' | 'channelId' | 'modelId'> | undefined,
  channels: Channel[],
  profiles: Profile[],
): string {
  if (meta?.profileId) {
    const profile = profiles.find((item) => item.id === meta.profileId)
    if (profile) return profile.name
  }
  if (meta?.modelId) {
    const modelName = channels
      .flatMap((channel) => channel.models)
      .find((model) => model.id === meta.modelId)?.name
    if (modelName) return modelName
  }
  const firstModel = channels[0]?.models[0]
  return firstModel?.name ?? '选择模型'
}

export function replaceSession(
  sessions: SessionMeta[],
  updated: SessionMeta,
): SessionMeta[] {
  const exists = sessions.some((session) => session.id === updated.id)
  const next = exists
    ? sessions.map((session) =>
        session.id === updated.id ? updated : session,
      )
    : [...sessions, updated]
  return next.sort(
    (left, right) =>
      right.updatedAt - left.updatedAt
      || left.id.localeCompare(right.id),
  )
}

export function updateSessionMode(
  sessions: SessionMeta[],
  sessionId: string,
  mode: NonNullable<SessionMeta['permissionMode']>,
): SessionMeta[] {
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, permissionMode: mode } : session,
  )
}

export function updateSessionContextUsage(
  sessions: SessionMeta[],
  sessionId: string,
  contextUsage: NonNullable<SessionMeta['contextUsage']>,
): SessionMeta[] {
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, contextUsage } : session,
  )
}

export function applyCompactionState(
  prev: StreamState,
  event:
    | { type: 'scheduled'; deadlineAt: number }
    | { type: 'queued' }
    | { type: 'running'; compactedCount: number }
    | { type: 'clear' },
): StreamState {
  if (event.type === 'clear') return { ...prev, compaction: undefined }
  if (event.type === 'scheduled') {
    return { ...prev, compaction: { status: 'scheduled', deadlineAt: event.deadlineAt } }
  }
  if (event.type === 'queued') return { ...prev, compaction: { status: 'queued' } }
  return {
    ...prev,
    compaction: { status: 'running', compactedCount: event.compactedCount },
  }
}

/** sessionId → 已落盘的历史消息 */
export const messagesBySessionAtom = atom<Map<string, SessionMessage[]>>(new Map())

/** sessionId → 当前流式状态 */
export const streamStatesAtom = atom<Map<string, StreamState>>(new Map())

/** 压缩期间排队的一条用户消息。每个会话独立，切换页面不会丢。 */
export const queuedPromptsAtom = atom<Map<string, string>>(new Map())

export interface DequeuedPrompt {
  prompts: Map<string, string>
  text?: string
}

/** 压缩结束时原子地取走一条排队输入，避免重复完成事件发送两次。 */
export function dequeueQueuedPrompt(
  current: Map<string, string>,
  sessionId: string,
): DequeuedPrompt {
  const text = current.get(sessionId)
  if (!text) return { prompts: current }
  const prompts = new Map(current)
  prompts.delete(sessionId)
  return { prompts, text }
}

/**
 * sessionId → 待授权请求队列。
 *
 * pi 的 preflight 是**串行**的，所以不会同时来一堆，但会一个接一个。
 * 用数组而不是单值，是为了渲染进程重载后能一次性把挂起的全捞回来。
 */
export const pendingPermissionsAtom = atom<Map<string, PermissionRequest[]>>(new Map())

/** 全会话待授权请求总数 —— 底部「N 个授权请求等待处理」跳转条用 */
export function pendingPermissionCount(
  pending: Map<string, PermissionRequest[]>,
): number {
  let count = 0
  for (const list of pending.values()) count += list.length
  return count
}

/** 第一个需要模态确认的高危请求（跨会话，按登记顺序） */
export function firstModalPermissionRequest(
  pending: Map<string, PermissionRequest[]>,
): PermissionRequest | undefined {
  for (const list of pending.values()) {
    const request = list.find((item) => item.requiresModal)
    if (request) return request
  }
  return undefined
}

export const pendingPermissionCountAtom = atom((get) =>
  pendingPermissionCount(get(pendingPermissionsAtom)),
)

export const modalPermissionRequestAtom = atom((get) =>
  firstModalPermissionRequest(get(pendingPermissionsAtom)),
)

/** sessionId → 待审批的计划 */
export const pendingPlansAtom = atom<Map<string, PlanRequest[]>>(new Map())

/** sessionId → 等待用户回答的问题 */
export const pendingAskUserAtom = atom<Map<string, AskUserRequest[]>>(new Map())

export const currentPlansAtom = atom((get) => {
  const id = get(currentSessionIdAtom)
  return id ? (get(pendingPlansAtom).get(id) ?? []) : []
})

/**
 * 对话流里的系统标记（切专家、压缩、重试）。模式由输入区的 Chip 持续展示。
 * 这些不落盘 —— 它们是本次会话期间的运行时事件，刷新后消失是可接受的。
 * TODO(阶段 6): 压缩标记要落盘，因为它对应 JSONL 里真实的 compaction entry。
 */
export interface Marker {
  id: string
  kind: MarkerKind
  text: string
  detail?: string
}

export const markersAtom = atom<Map<string, Marker[]>>(new Map())

export const currentMarkersAtom = atom((get) => {
  const id = get(currentSessionIdAtom)
  return id ? (get(markersAtom).get(id) ?? []) : []
})

export const currentPermissionsAtom = atom((get) => {
  const id = get(currentSessionIdAtom)
  return id ? (get(pendingPermissionsAtom).get(id) ?? []) : []
})

/** 当前会话的流式状态（派生） */
export const currentStreamAtom = atom((get) => {
  const id = get(currentSessionIdAtom)
  return id ? (get(streamStatesAtom).get(id) ?? emptyStreamState()) : emptyStreamState()
})

export const currentMessagesAtom = atom((get) => {
  const id = get(currentSessionIdAtom)
  return id ? (get(messagesBySessionAtom).get(id) ?? []) : []
})

export const currentAskUserAtom = atom((get) => {
  const id = get(currentSessionIdAtom)
  return id ? (get(pendingAskUserAtom).get(id) ?? []) : []
})

interface PendingRequestBase {
  requestId: string
  sessionId: string
}

/**
 * 把主进程快照合并进本地队列。按 requestId 去重，避免 StrictMode
 * 重挂监听器或「实时事件 + 重载快照」同时到达时显示两张相同卡片。
 */
export function mergePendingRequests<T extends PendingRequestBase>(
  current: Map<string, T[]>,
  incoming: T[],
): Map<string, T[]> {
  const next = new Map(current)
  for (const request of incoming) {
    const list = next.get(request.sessionId) ?? []
    if (list.some((item) => item.requestId === request.requestId)) continue
    next.set(request.sessionId, [...list, request])
  }
  return next
}

/** 把主进程返回的全量快照按 sessionId 建索引。 */
export function indexPendingRequests<T extends PendingRequestBase>(requests: T[]): Map<string, T[]> {
  return mergePendingRequests(new Map(), requests)
}

export interface RunFrameCursor {
  runId: number
  settled: boolean
}

/** 丢弃旧 Run 以及已经 settled 的同 Run 迟到帧。 */
export function acceptRunFrame(
  cursors: Map<string, RunFrameCursor>,
  sessionId: string,
  runId: number,
): boolean {
  if (!sessionId || runId <= 0) return true
  const current = cursors.get(sessionId)
  if (current && runId < current.runId) return false
  if (current && runId === current.runId) return !current.settled
  cursors.set(sessionId, { runId, settled: false })
  return true
}

export function settleRunFrame(
  cursors: Map<string, RunFrameCursor>,
  sessionId: string,
  runId: number,
): void {
  if (!sessionId || runId <= 0) return
  const current = cursors.get(sessionId)
  if (current?.runId === runId) {
    cursors.set(sessionId, { runId, settled: true })
  }
}

// ── 状态机 ────────────────────────────────────────────────────────

/**
 * 纯函数状态机：(prev, event) => next。
 *
 * 保持纯函数是刻意的——它和 IPC、React 都无关，可以单独写测试。
 */
/**
 * 渲染进程内部才有的事件，不来自主进程 —— 由 120ms 延迟定时器派发。
 * 见 docs/06-设计决策.md 决定 2。
 */
export type LocalEvent =
  | { type: 'tool_running'; toolCallId: string }
  /** 用户拒绝了授权请求，卡片从「等待授权」落为「已拒绝」 */
  | { type: 'tool_denied'; toolCallId: string }

export function applyAgentEvent(prev: StreamState, event: AgentEvent | LocalEvent): StreamState {
  switch (event.type) {
    case 'run_start':
      // 自动压缩的 3 秒提示可能与下一次发送重叠，不能被 run_start 静默抹掉。
      return { ...emptyStreamState(), running: true, compaction: prev.compaction }

    case 'text_delta':
      return { ...prev, text: prev.text + event.delta, error: undefined }

    case 'thinking_delta':
      return { ...prev, thinking: prev.thinking + event.delta }

    case 'tool_start':
      // ★ 注意初始态是 awaiting_permission 而不是 running。
      //   pi 的 tool_start 比授权请求早约 5ms（实测），先按最保守的态渲染，
      //   由 useGlobalAgentListeners 的 120ms 定时器决定要不要升级成 running。
      //   反过来（先 running 再降级）会让用户看到「正在执行 rm -rf」然后才弹授权框。
      return {
        ...prev,
        toolActivities: [
          ...prev.toolActivities,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            status: 'awaiting_permission',
            startedAt: Date.now(),
          },
        ],
      }

    // 由 120ms 定时器派发：这段时间没等到授权请求，说明是免检工具
    case 'tool_running':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolCallId === event.toolCallId && t.status === 'awaiting_permission'
            ? { ...t, status: 'running' as const }
            : t,
        ),
      }

    // 用户点了拒绝：只有还停在「等待授权」的卡片才落为已拒绝。
    // 已经在执行中的工具不可能收到授权请求，所以不需要处理 running → denied。
    case 'tool_denied':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolCallId === event.toolCallId && t.status === 'awaiting_permission'
            ? { ...t, status: 'denied' as const }
            : t,
        ),
      }

    case 'tool_end':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          // 已被用户拒绝的工具保持 denied：pi 对 policy 拦截调用会补发
          // tool_end(isError)，不能让它把「已拒绝」覆盖成「失败」。
          t.toolCallId === event.toolCallId && t.status !== 'denied'
            ? {
                ...t,
                status: event.isError ? ('error' as const) : ('success' as const),
                elapsedMs: Date.now() - t.startedAt,
                ...(event.output
                  ? {
                      result: {
                        isError: event.isError,
                        text: event.output,
                      },
                    }
                  : {}),
              }
            : t,
        ),
      }

    case 'turn_end':
      return event.usage
        ? {
            ...prev,
            inputTokens: event.usage.totalTokens,
            outputTokens: event.usage.output,
            costUsd: event.usage.cost.total,
          }
        : prev

    case 'message_end':
      // 一条消息落定了，清掉流式缓冲——正文已经进历史了，
      // 继续留着会导致同一段文字显示两遍
      return { ...prev, text: '', thinking: '' }

    case 'error':
      return { ...prev, running: false, error: event.message }

    case 'run_end':
      // ★ 清掉实时工具卡片，把展示权交给历史消息里的卡片。
      //   不清的话同一个工具会显示两遍——实时的一张、历史的一张。
      //   交接时机放在 run_end 而不是 message_end，是因为 assistant 消息
      //   在工具执行**之前**就完成了，太早交接会丢掉「执行中」「等待授权」这两个态。
      return { ...prev, running: false, toolActivities: [] }

    default:
      return prev
  }
}
