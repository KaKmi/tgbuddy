/**
 * legacy JSONL 会话导入契约。
 *
 * ## 线性，不是树
 *
 * 曾经打算用 pi 的 `id`/`parentId` 会话树，交互设计明确否掉了分支 / 时间旅行
 * （见 docs/06-设计决策.md 决定 5），改成 **append-only 线性日志**。
 *
 * 「回到那一步」用两个更便宜的动作满足：
 *   - **编辑并重发** → `truncate` entry（软删除，可撤销）
 *   - **以此为起点新建会话** → 新会话的 meta 里记一个 `originRef` 扁平指针
 *
 * K05 起生产消息历史由 pi Session backend 持久化；这里的线性结构只用于 K06
 * 一次性导入、导出和兼容诊断，不再是 canonical storage。
 *
 * ## legacy 磁盘布局
 *
 * ```
 * ~/.tgbuddy/
 * ├── sessions.json          # 索引：轻量元数据，全量重写 + 原子写
 * └── sessions/{id}.jsonl    # 消息：逐行追加，首行是 header
 * ```
 *
 * 分两层是为了「列出 200 个会话」不用读 200 个大文件。
 */

import type { SessionMessage } from './message.ts'
import type { ContextUsage } from './context.ts'
import type { PermissionMode } from './permission.ts'

export type SessionVisibility = 'top_level' | 'internal'

/**
 * 会话元数据只服务于 catalog 和侧边栏查询，不要求读取完整消息历史。
 */
export interface SessionMeta {
  id: string
  title: string
  /** internal 会话只承载子 Agent 消息，不进入主会话列表。 */
  visibility?: SessionVisibility
  parentTaskId?: string
  /** default 可被首次 root Run 异步生成覆盖；user 永远优先于迟到结果。 */
  titleSource?: 'default' | 'generated' | 'user'
  workspaceId?: string
  channelId?: string
  modelId?: string
  /** C04：会话选中的 Profile（命名模型配置），下一 Run 固化其快照 */
  profileId?: string
  expertId?: string
  pinned?: boolean
  archived?: boolean
  permissionMode?: PermissionMode
  status?: 'idle' | 'running' | 'done' | 'failed' | 'interrupted'
  statusDetail?: string
  lastActivity?: string
  artifactCount?: number
  contextUsage?: ContextUsage
  originRef?: { sessionId: string; messageId: string }
  createdAt: number
  updatedAt: number
}

/** legacy JSONL 格式版本。改了 entry 结构就 +1，并在导入端写迁移。 */
export const SESSION_FORMAT_VERSION = 2

/** JSONL 首行，不参与消息重放 */
export interface SessionHeader {
  type: 'session'
  version: number
  /** ★ 版本护栏：不做归一化翻译的代价，将来 pi 改结构时靠它判断在读什么 */
  kernel: string
  cwd: string
  createdAt: number
}

interface EntryBase {
  id: string
  timestamp: number
}

export type SessionEntry =
  | (EntryBase & { type: 'message'; message: SessionMessage })
  | (EntryBase & { type: 'model_change'; channelId: string; modelId: string })
  | (EntryBase & {
      type: 'compaction'
      summary: string
      firstKeptEntryId: string
      tokensBefore: number
      /** v1 预留结构没有这个字段，读取旧会话时按 0 处理 */
      compactedCount?: number
    })
  /** 应用状态，**不进 LLM 上下文** */
  | (EntryBase & { type: 'custom'; key: string; value: unknown })
  /** 「编辑并重发」的软删除标记：从 fromId（含）之后的消息全部失效 */
  | (EntryBase & { type: 'truncate'; fromId: string })

/** JSONL 里的一行 */
export type SessionLine = SessionHeader | SessionEntry

/** 交给 kernel 压缩适配器的线性历史。只暴露压缩算法需要的字段。 */
export type CompactionSourceEntry = Extract<SessionEntry, { type: 'message' | 'compaction' }>
