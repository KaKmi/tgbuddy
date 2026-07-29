/**
 * 会话存储格式。
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
 * ## 磁盘布局
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

/** 存储格式版本。改了 entry 结构就 +1，并在读取端写迁移 */
export const SESSION_FORMAT_VERSION = 1

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
    })
  /** 应用状态，**不进 LLM 上下文** */
  | (EntryBase & { type: 'custom'; key: string; value: unknown })
  /** 「编辑并重发」的软删除标记：从 fromId（含）之后的消息全部失效 */
  | (EntryBase & { type: 'truncate'; fromId: string })

/** JSONL 里的一行 */
export type SessionLine = SessionHeader | SessionEntry
