import type { CompactionSourceEntry } from '../../shared/contracts/session.ts'
import {
  KERNEL_ID,
  type CompactionMessage,
  type PersistedSessionEntry,
  type SessionMessage,
} from '../../shared/contracts/message.ts'
import type { MessageSession, MessageStore } from './message-store.ts'

export interface AppendCompactionInput {
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
}

export interface SessionMessageHistory {
  create(sessionId: string, cwd: string): Promise<void>
  messages(sessionId: string): Promise<SessionMessage[]>
  compactedMessages(sessionId: string, compactionId: string): Promise<SessionMessage[]>
  compactionSourceEntries(sessionId: string): Promise<CompactionSourceEntry[]>
  append(sessionId: string, message: SessionMessage): Promise<void>
  appendCompaction(
    sessionId: string,
    input: AppendCompactionInput,
  ): Promise<CompactionMessage>
  truncate(
    sessionId: string,
    fromMessageId: string,
  ): Promise<SessionMessage[]>
  clonePrefix(
    sourceSessionId: string,
    targetSessionId: string,
    throughMessageId: string,
    cwd: string,
  ): Promise<SessionMessage[]>
  countArtifacts(sessionId: string): Promise<number>
  delete(sessionId: string): Promise<void>
}

export interface CreateSessionMessageHistoryOptions {
  store: MessageStore
  createId(): string
  now(): number
}

interface NoticeDetails {
  notice?: unknown
}

interface CompactionDetails {
  compactedCount?: unknown
  legacyFirstKeptEntryId?: unknown
  legacyTruncated?: unknown
}

class DefaultSessionMessageHistory implements SessionMessageHistory {
  readonly #store: MessageStore
  readonly #createId: () => string
  readonly #now: () => number
  readonly #sessionLocks = new Map<string, Promise<void>>()

  constructor(options: CreateSessionMessageHistoryOptions) {
    this.#store = options.store
    this.#createId = options.createId
    this.#now = options.now
  }

  async create(sessionId: string, cwd: string): Promise<void> {
    await this.#withSessionLock(sessionId, async () => {
      await this.#store.create({ sessionId, cwd, kernel: KERNEL_ID })
    })
  }

  async messages(sessionId: string): Promise<SessionMessage[]> {
    return this.#withSessionLock(sessionId, async () => {
      const session = await this.#store.open(sessionId, KERNEL_ID)
      return session ? replayActiveMessages(await session.activeEntries()) : []
    })
  }

  async compactedMessages(
    sessionId: string,
    compactionId: string,
  ): Promise<SessionMessage[]> {
    return this.#withSessionLock(sessionId, async () => {
      const session = await this.#store.open(sessionId, KERNEL_ID)
      if (!session) return []
      const entries = await session.entries()
      const compactionIndex = entries.findIndex(
        (entry) => entry.type === 'compaction' && entry.id === compactionId,
      )
      if (compactionIndex === -1) return []
      const compaction = entries[compactionIndex]
      if (!compaction || compaction.type !== 'compaction') return []

      const before = rawMessages(entries.slice(0, compactionIndex))
      const firstKeptEntryId = compactionBoundaryId(compaction)
      const boundaryIndex = before.findIndex(
        (message) => message.id === firstKeptEntryId,
      )
      return boundaryIndex === -1 ? before : before.slice(0, boundaryIndex)
    })
  }

  async compactionSourceEntries(
    sessionId: string,
  ): Promise<CompactionSourceEntry[]> {
    return (await this.messages(sessionId)).map((message) => {
      if (message.kind === 'compaction') {
        return {
          type: 'compaction',
          id: message.id,
          timestamp: message.createdAt,
          summary: message.summary,
          firstKeptEntryId: message.firstKeptEntryId,
          tokensBefore: message.tokensBefore,
          compactedCount: message.compactedCount,
        } satisfies CompactionSourceEntry
      }
      return {
        type: 'message',
        id: message.id,
        timestamp: message.createdAt,
        message,
      } satisfies CompactionSourceEntry
    })
  }

  async append(sessionId: string, message: SessionMessage): Promise<void> {
    await this.#withSessionLock(sessionId, async () => {
      const session = await this.#requireSession(sessionId)
      const entries = await session.activeEntries()
      await session.append(toPersistedEntry(message, entries.at(-1)?.id ?? null))
    })
  }

  async appendCompaction(
    sessionId: string,
    input: AppendCompactionInput,
  ): Promise<CompactionMessage> {
    return this.#withSessionLock(sessionId, async () => {
      const session = await this.#requireSession(sessionId)
      const entries = await session.activeEntries()
      const activeMessages = replayActiveMessages(entries)
      const boundaryIndex = activeMessages.findIndex(
        (message) => message.id === input.firstKeptEntryId,
      )
      const marker: CompactionMessage = {
        kind: 'compaction',
        id: this.#createId(),
        createdAt: this.#now(),
        summary: input.summary,
        compactedCount:
          boundaryIndex === -1 ? activeMessages.length : boundaryIndex,
        tokensBefore: input.tokensBefore,
        firstKeptEntryId: input.firstKeptEntryId,
      }
      await session.append(toPersistedEntry(marker, entries.at(-1)?.id ?? null))
      return marker
    })
  }

  async truncate(
    sessionId: string,
    fromMessageId: string,
  ): Promise<SessionMessage[]> {
    return this.#withSessionLock(sessionId, async () => {
      const session = await this.#requireSession(sessionId)
      const branch = await session.activeEntries()
      const activeMessages = replayActiveMessages(branch)
      const activeTargetIndex = activeMessages.findIndex(
        (message) => message.id === fromMessageId,
      )
      const targetMessage = activeMessages[activeTargetIndex]
      if (
        !targetMessage
        || targetMessage.kind !== 'kernel'
        || targetMessage.message.role !== 'user'
      ) {
        throw new Error(`只能从当前历史中的用户消息编辑重发：${fromMessageId}`)
      }

      // 审计 entry 先追加在旧 leaf 后，再移动 active leaf；即使 move 失败，
      // 原历史也仍是有效路径，同时留下可诊断记录。
      await session.append({
        type: 'custom',
        id: this.#createId(),
        parentId: branch.at(-1)?.id ?? null,
        timestamp: toIsoTimestamp(this.#now()),
        customType: 'tgbuddy.truncate',
        data: {
          fromId: fromMessageId,
          reason: 'edit_and_resend',
        },
      })

      if (activeMessages[0]?.kind === 'compaction') {
        return this.#rebuildCompactedPrefix(
          session,
          activeMessages.slice(0, activeTargetIndex),
        )
      }

      const branchTargetIndex = branch.findIndex(
        (entry) => entry.id === fromMessageId,
      )
      await session.moveTo(branch[branchTargetIndex - 1]?.id ?? null)
      return replayActiveMessages(await session.activeEntries())
    })
  }

  async clonePrefix(
    sourceSessionId: string,
    targetSessionId: string,
    throughMessageId: string,
    cwd: string,
  ): Promise<SessionMessage[]> {
    return this.#withSessionLock(sourceSessionId, async () => {
      const source = await this.#requireSession(sourceSessionId)
      const branch = await source.activeEntries()
      const activeMessages = replayActiveMessages(branch)
      const targetIndex = activeMessages.findIndex(
        (message) => message.id === throughMessageId,
      )
      if (targetIndex === -1) {
        throw new Error(`消息不在当前有效历史中：${throughMessageId}`)
      }
      const prefix = activeMessages.slice(0, targetIndex + 1)
      const idMap = new Map(
        prefix.map((message) => [message.id, this.#createId()]),
      )

      return this.#withSessionLock(targetSessionId, async () => {
        const target = await this.#store.create({
          sessionId: targetSessionId,
          cwd,
          kernel: KERNEL_ID,
        })
        let parentId: string | null = null
        for (const message of prefix) {
          const cloned = cloneMessage(message, idMap)
          await target.append(toPersistedEntry(cloned, parentId))
          parentId = cloned.id
        }
        return replayActiveMessages(await target.activeEntries())
      })
    })
  }

  async countArtifacts(sessionId: string): Promise<number> {
    return this.#withSessionLock(sessionId, async () => {
      const session = await this.#store.open(sessionId, KERNEL_ID)
      return session
        ? countArtifacts(rawMessages(await session.activeEntries()))
        : 0
    })
  }

  async delete(sessionId: string): Promise<void> {
    await this.#withSessionLock(sessionId, () => this.#store.delete(sessionId))
  }

  async #requireSession(sessionId: string): Promise<MessageSession> {
    const session = await this.#store.open(sessionId, KERNEL_ID)
    if (!session) {
      throw new Error(`Session 消息后端不存在：${sessionId}`)
    }
    return session
  }

  async #rebuildCompactedPrefix(
    session: MessageSession,
    prefix: SessionMessage[],
  ): Promise<SessionMessage[]> {
    const marker = prefix[0]
    if (!marker || marker.kind !== 'compaction') {
      throw new Error('压缩历史缺少摘要边界')
    }

    await session.moveTo(null)
    const markerId = this.#createId()
    await session.append({
      type: 'compaction',
      id: markerId,
      parentId: null,
      timestamp: toIsoTimestamp(marker.createdAt),
      summary: marker.summary,
      firstKeptEntryId: marker.firstKeptEntryId,
      tokensBefore: marker.tokensBefore,
      details: {
        compactedCount: marker.compactedCount,
        legacyFirstKeptEntryId: marker.firstKeptEntryId,
        legacyTruncated: true,
      },
    })

    let parentId = markerId
    for (const message of prefix.slice(1)) {
      const cloned = structuredClone(message)
      cloned.id = this.#createId()
      await session.append(toPersistedEntry(cloned, parentId))
      parentId = cloned.id
    }
    return replayActiveMessages(await session.activeEntries())
  }

  async #withSessionLock<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#sessionLocks.get(sessionId) ?? Promise.resolve()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate, () => gate)
    this.#sessionLocks.set(sessionId, tail)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.#sessionLocks.get(sessionId) === tail) {
        this.#sessionLocks.delete(sessionId)
      }
    }
  }
}

export function createSessionMessageHistory(
  options: CreateSessionMessageHistoryOptions,
): SessionMessageHistory {
  return new DefaultSessionMessageHistory(options)
}

function toPersistedEntry(
  message: SessionMessage,
  parentId: string | null,
): PersistedSessionEntry {
  const base = {
    id: message.id,
    parentId,
    timestamp: toIsoTimestamp(message.createdAt),
  }
  if (message.kind === 'kernel') {
    return {
      ...base,
      type: 'message',
      message: message.message,
    }
  }
  if (message.kind === 'notice') {
    return {
      ...base,
      type: 'custom_message',
      customType: 'tgbuddy.notice',
      content: message.text,
      details: { notice: message.notice },
      display: message.display,
    }
  }
  return {
    ...base,
    type: 'compaction',
    summary: message.summary,
    firstKeptEntryId: message.firstKeptEntryId,
    tokensBefore: message.tokensBefore,
    details: { compactedCount: message.compactedCount },
  }
}

function cloneMessage(
  message: SessionMessage,
  idMap: Map<string, string>,
): SessionMessage {
  const cloned = structuredClone(message)
  if (cloned.kind === 'compaction') {
    return {
      ...cloned,
      id: requireMappedId(idMap, message.id),
      firstKeptEntryId:
        idMap.get(cloned.firstKeptEntryId) ?? cloned.firstKeptEntryId,
    }
  }
  return {
    ...cloned,
    id: requireMappedId(idMap, message.id),
  }
}

function requireMappedId(idMap: Map<string, string>, sourceId: string): string {
  const mapped = idMap.get(sourceId)
  if (!mapped) throw new Error(`复制消息 ID 失败：${sourceId}`)
  return mapped
}

function replayActiveMessages(
  entries: PersistedSessionEntry[],
): SessionMessage[] {
  const lastCompactionIndex = entries.findLastIndex(
    (entry) => entry.type === 'compaction',
  )
  if (lastCompactionIndex === -1) return rawMessages(entries)

  const compactionEntry = entries[lastCompactionIndex]
  if (!compactionEntry || compactionEntry.type !== 'compaction') {
    return rawMessages(entries)
  }
  const marker = toSessionMessage(compactionEntry)
  if (!marker || marker.kind !== 'compaction') return rawMessages(entries)

  if (isLegacyTruncatedCompaction(compactionEntry)) {
    const leafIndex = entries.findLastIndex(
      (entry) =>
        entry.type === 'leaf'
        && entry.targetId === compactionEntry.id,
    )
    // pi 的 getBranch() 可能只返回 leaf 指向的有效路径，不包含 leaf entry 本身。
    // 此时 compaction 后的消息仍是有效 tail，不能因为看不到内部指针而被丢弃。
    const tailIndex = leafIndex === -1 ? lastCompactionIndex : leafIndex
    return [
      marker,
      ...rawMessages(entries.slice(tailIndex + 1)),
    ]
  }

  const messages: SessionMessage[] = [marker]
  let reachedBoundary = false
  for (const entry of entries) {
    if (entry.id === compactionEntry.firstKeptEntryId) reachedBoundary = true
    const message = toSessionMessage(entry)
    if (reachedBoundary && message && message.kind !== 'compaction') {
      messages.push(message)
    }
  }
  return messages
}

function rawMessages(entries: PersistedSessionEntry[]): SessionMessage[] {
  return entries.flatMap((entry) => {
    const message = toSessionMessage(entry)
    return message && message.kind !== 'compaction' ? [message] : []
  })
}

function toSessionMessage(
  entry: PersistedSessionEntry,
): SessionMessage | undefined {
  const createdAt = Date.parse(entry.timestamp)
  if (!Number.isFinite(createdAt)) return undefined

  if (entry.type === 'message') {
    if (
      entry.message.role !== 'user'
      && entry.message.role !== 'assistant'
      && entry.message.role !== 'toolResult'
    ) {
      return undefined
    }
    return {
      kind: 'kernel',
      id: entry.id,
      createdAt,
      message: entry.message,
    }
  }
  if (entry.type === 'custom_message' && entry.customType === 'tgbuddy.notice') {
    const details = isRecord(entry.details) ? entry.details as NoticeDetails : undefined
    if (!isNoticeKind(details?.notice)) return undefined
    return {
      kind: 'notice',
      id: entry.id,
      createdAt,
      notice: details.notice,
      text: typeof entry.content === 'string'
        ? entry.content
        : entry.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n'),
      display: entry.display,
    }
  }
  if (entry.type === 'compaction') {
    const details = isRecord(entry.details)
      ? entry.details as CompactionDetails
      : undefined
    const firstKeptEntryId =
      typeof details?.legacyFirstKeptEntryId === 'string'
        ? details.legacyFirstKeptEntryId
        : entry.firstKeptEntryId
    if (!firstKeptEntryId) return undefined
    return {
      kind: 'compaction',
      id: entry.id,
      createdAt,
      summary: entry.summary,
      compactedCount:
        typeof details?.compactedCount === 'number'
          ? details.compactedCount
          : 0,
      tokensBefore: entry.tokensBefore,
      firstKeptEntryId,
    }
  }
  return undefined
}

function legacyCompactionBoundaryId(
  entry: Extract<PersistedSessionEntry, { type: 'compaction' }>,
): string | undefined {
  if (!isRecord(entry.details)) return undefined
  const details = entry.details as CompactionDetails
  return typeof details.legacyFirstKeptEntryId === 'string'
    ? details.legacyFirstKeptEntryId
    : undefined
}

function compactionBoundaryId(
  entry: Extract<PersistedSessionEntry, { type: 'compaction' }>,
): string | undefined {
  return legacyCompactionBoundaryId(entry) ?? entry.firstKeptEntryId
}

function isLegacyTruncatedCompaction(
  entry: Extract<PersistedSessionEntry, { type: 'compaction' }>,
): boolean {
  if (!isRecord(entry.details)) return false
  const details = entry.details as CompactionDetails
  return details.legacyTruncated === true
}

function countArtifacts(messages: SessionMessage[]): number {
  const producing = new Set(['write', 'edit'])
  const callPaths = new Map<string, string>()

  for (const message of messages) {
    if (message.kind !== 'kernel' || message.message.role !== 'assistant') continue
    for (const block of message.message.content) {
      if (block.type !== 'toolCall' || !producing.has(block.name)) continue
      const path = isRecord(block.arguments) ? block.arguments.path : undefined
      if (typeof path === 'string') callPaths.set(block.id, path)
    }
  }

  const produced = new Set<string>()
  for (const message of messages) {
    if (message.kind !== 'kernel' || message.message.role !== 'toolResult') continue
    if (message.message.isError) continue
    const path = callPaths.get(message.message.toolCallId)
    if (path) produced.add(path)
  }
  return produced.size
}

function toIsoTimestamp(value: number): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`无效消息时间戳：${value}`)
  }
  return timestamp.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNoticeKind(
  value: unknown,
): value is Extract<SessionMessage, { kind: 'notice' }>['notice'] {
  return (
    value === 'expert_changed'
    || value === 'mode_changed'
    || value === 'compaction'
    || value === 'session_resumed'
  )
}
