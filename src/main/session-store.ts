/**
 * 会话存储 —— 索引 JSON + 消息 JSONL。
 *
 * ```
 * ~/.tgbuddy/
 * ├── sessions.json          # 索引：全量重写 + 原子写（safe-file.ts）
 * └── sessions/{id}.jsonl    # 消息：逐行追加，首行 header
 * ```
 *
 * 两层分开是为了「列出 200 个会话」不用读 200 个大文件。
 *
 * 结构是**线性 append-only**，不是树 —— 见 docs/06-设计决策.md 决定 5。
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionMeta } from '../shared/ipc.ts'
import { KERNEL_ID, type SessionMessage } from '../shared/types/message.ts'
import {
  SESSION_FORMAT_VERSION,
  type SessionEntry,
  type SessionHeader,
  type SessionLine,
} from '../shared/types/session.ts'
import { DATA_DIR, ensureDataDir } from './channel-store.ts'
import { readJsonFileSafe, removeJsonFile, writeJsonFileAtomic } from './safe-file.ts'
import { sanitizeForDisk } from './sanitize.ts'

const INDEX_FILE = join(DATA_DIR, 'sessions.json')
const SESSIONS_DIR = join(DATA_DIR, 'sessions')

interface SessionIndex {
  version: number
  sessions: SessionMeta[]
}

/** 8 位 hex */
export function newId(): string {
  return randomBytes(4).toString('hex')
}

function ensureSessionsDir(): void {
  ensureDataDir()
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })
}

function jsonlPath(id: string): string {
  return join(SESSIONS_DIR, `${id}.jsonl`)
}

// ── 索引 ──────────────────────────────────────────────────────────

function readIndex(): SessionIndex {
  ensureSessionsDir()
  const parsed = readJsonFileSafe<SessionIndex>(INDEX_FILE)
  if (!parsed || !Array.isArray(parsed.sessions)) {
    return { version: SESSION_FORMAT_VERSION, sessions: [] }
  }
  return parsed
}

function writeIndex(index: SessionIndex): void {
  ensureSessionsDir()
  writeJsonFileAtomic(INDEX_FILE, index)
}

export function listSessions(): SessionMeta[] {
  return readIndex().sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): SessionMeta | undefined {
  return readIndex().sessions.find((s) => s.id === id)
}

export function createSession(input: {
  title?: string
  channelId?: string
  modelId?: string
}): SessionMeta {
  const now = Date.now()
  const meta: SessionMeta = {
    id: newId(),
    title: input.title ?? '新会话',
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    createdAt: now,
    updatedAt: now,
  }

  // 先写 JSONL 头，再写索引 —— 顺序有讲究：
  // 若中途崩溃，宁可留一个索引里没有的孤儿文件（无害），
  // 也不要索引里有一条指向不存在文件的记录（打开就报错）
  const header: SessionHeader = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    kernel: KERNEL_ID,
    cwd: process.cwd(),
    createdAt: now,
  }
  ensureSessionsDir()
  writeFileSync(jsonlPath(meta.id), `${JSON.stringify(header)}\n`, 'utf-8')

  const index = readIndex()
  index.sessions.unshift(meta)
  writeIndex(index)

  cache.set(meta.id, [])
  return meta
}

export function updateMeta(id: string, patch: Partial<SessionMeta>): void {
  const index = readIndex()
  const i = index.sessions.findIndex((s) => s.id === id)
  if (i === -1) return
  index.sessions[i] = { ...index.sessions[i]!, ...patch, id, updatedAt: Date.now() }
  writeIndex(index)
}

export function deleteSession(id: string): void {
  const index = readIndex()
  index.sessions = index.sessions.filter((s) => s.id !== id)
  writeIndex(index)

  removeJsonFile(jsonlPath(id))
  try {
    rmSync(jsonlPath(id), { force: true })
  } catch {
    /* removeJsonFile 已经处理，这里只是兜底 */
  }
  cache.delete(id)
}

// ── 消息 ──────────────────────────────────────────────────────────

/**
 * 内存缓存。orchestrator 每次 send 都要读全部历史，
 * 每次解析整个 JSONL 太浪费。append 时同步更新，保持一致。
 */
const cache = new Map<string, SessionMessage[]>()

export function getMessages(id: string): SessionMessage[] {
  const cached = cache.get(id)
  if (cached) return cached

  const messages = replayJsonl(id)
  cache.set(id, messages)
  return messages
}

/**
 * 重放 JSONL 得到有效消息列表。
 *
 * ⚠️ **逐行 try/catch，坏行跳过并记日志。**
 * 每行独立解析，避免一行损坏导致整个会话无法恢复。
 */
function replayJsonl(id: string): SessionMessage[] {
  const path = jsonlPath(id)
  if (!existsSync(path)) return []

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e) {
    console.error(`[session] 读取失败：${path}`, e)
    return []
  }

  const messages: SessionMessage[] = []
  /** truncate 标记：记录被软删除的起点，重放到最后再统一裁剪 */
  const truncateFrom: string[] = []
  let badLines = 0

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue

    let parsed: SessionLine
    try {
      parsed = JSON.parse(line) as SessionLine
    } catch {
      badLines++
      continue
    }

    if (parsed.type === 'session') continue // header

    switch (parsed.type) {
      case 'message':
        messages.push(parsed.message)
        break
      case 'truncate':
        truncateFrom.push(parsed.fromId)
        break
      // model_change / compaction / custom 不产生消息。
      // TODO(阶段 6): compaction 要在这里改写重放结果 ——
      //   遇到 compaction 时丢弃 firstKeptEntryId 之前的消息、插入 summary
      default:
        break
    }
  }

  if (badLines > 0) {
    console.warn(`[session] ${id}.jsonl 有 ${badLines} 行损坏，已跳过`)
  }

  // 应用软删除：从最早的截断点起，后面的全部失效
  if (truncateFrom.length > 0) {
    let cut = messages.length
    for (const fromId of truncateFrom) {
      const i = messages.findIndex((m) => m.id === fromId)
      if (i !== -1 && i < cut) cut = i
    }
    return messages.slice(0, cut)
  }

  return messages
}

/**
 * 统计会话产出了多少个文件（侧边栏那句「N 个产物」）。
 *
 * **从已落盘的消息里重新算，不维护增量计数器。** 两个好处：
 *   - 重启后自然正确，不需要额外持久化
 *   - 「编辑并重发」截断历史后，计数会自动跟着回退
 *
 * 只在一次 run 结束时调用，不是每次列表都算，所以 O(n) 可以接受。
 */
export function countArtifacts(id: string): number {
  /** 会产生产物的工具 */
  const PRODUCING = new Set(['write', 'edit'])

  // ① 先从 assistant 消息里收集 toolCallId → 路径
  //
  // ⚠️ 不能读工具结果的 `details` —— pi 内置的 write 返回 `details: undefined`，
  //    edit 返回的是 `{ diff, patch }`，都不带路径。
  //    从**调用参数**推导反而更稳：不依赖任何工具的 details 形状。
  const callPaths = new Map<string, string>()

  for (const m of getMessages(id)) {
    if (m.kind !== 'kernel' || m.message.role !== 'assistant') continue
    for (const block of m.message.content) {
      if (block.type !== 'toolCall' || !PRODUCING.has(block.name)) continue
      const path = (block.arguments as { path?: string })?.path
      if (typeof path === 'string') callPaths.set(block.id, path)
    }
  }

  // ② 再看哪些调用真的成功了 —— 报错的不算产物
  const produced = new Set<string>()
  for (const m of getMessages(id)) {
    if (m.kind !== 'kernel' || m.message.role !== 'toolResult') continue
    if (m.message.isError) continue
    const path = callPaths.get(m.message.toolCallId)
    if (path) produced.add(path)
  }

  return produced.size
}

export function appendMessage(id: string, message: SessionMessage): void {
  const entry: SessionEntry = {
    type: 'message',
    id: message.id,
    timestamp: message.createdAt,
    message: sanitizeForDisk(message),
  }
  appendEntry(id, entry)

  // 缓存里存**未瘦身**的版本 —— 本次会话继续用完整内容，
  // 瘦身只影响下次从磁盘重放
  const cached = cache.get(id)
  if (cached) cached.push(message)

  updateMeta(id, {})
}

/**
 * 「编辑并重发」：软删除 fromId 及其之后的所有消息。
 *
 * 不物理删除，写一条 truncate 标记 —— 这样可撤销，
 * 而且 append-only 的日志永远不需要重写。
 */
export function truncateFrom(id: string, fromMessageId: string): void {
  appendEntry(id, {
    type: 'truncate',
    id: newId(),
    timestamp: Date.now(),
    fromId: fromMessageId,
  })
  cache.delete(id) // 让下次读取重新重放
  updateMeta(id, {})
}

function appendEntry(id: string, entry: SessionEntry): void {
  ensureSessionsDir()
  const path = jsonlPath(id)

  // 文件不存在说明索引和磁盘不同步（手工删过？），补一个 header 免得后续全乱
  if (!existsSync(path)) {
    const header: SessionHeader = {
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      kernel: KERNEL_ID,
      cwd: process.cwd(),
      createdAt: Date.now(),
    }
    writeFileSync(path, `${JSON.stringify(header)}\n`, 'utf-8')
  }

  try {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch (e) {
    console.error(`[session] 追加失败：${path}`, e)
  }
}
