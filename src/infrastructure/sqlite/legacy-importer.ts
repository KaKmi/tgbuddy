import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  toKernelMessages,
  type PersistedSessionEntry,
} from '../../shared/contracts/message.ts'
import type { ContextUsage } from '../../shared/contracts/context.ts'
import type {
  SessionEntry,
  SessionHeader,
  SessionMeta,
} from '../../shared/contracts/session.ts'

export interface LegacyParseInput {
  sessionId: string
  relativePath: string
  indexMeta: unknown
  text: string
}

export interface LegacyDiagnostic {
  sessionId: string
  relativePath: string
  line: number
  category: 'syntax' | 'schema' | 'compatibility' | 'conflict'
  code: string
  reason: string
}

export interface LegacyParseResult {
  sessionId: string
  relativePath: string
  header: SessionHeader
  entries: SessionEntry[]
  entryLines: Record<string, number>
  diagnostics: LegacyDiagnostic[]
  fingerprint: string
}

export interface LegacyMapResult {
  entries: PersistedSessionEntry[]
  diagnostics: LegacyDiagnostic[]
  activeMessageIds: string[]
  entryDigest: string
}

export interface LegacySessionCandidate {
  meta: SessionMeta
  parsed: LegacyParseResult
  mapped: LegacyMapResult
}

export interface LegacyLoadFailure {
  sessionId?: string
  relativePath: string
  line: number
  category: 'io' | 'schema' | 'conflict' | 'runtime'
  code: string
  reason: string
}

export interface LegacyLoadResult {
  found: boolean
  candidates: LegacySessionCandidate[]
  failures: LegacyLoadFailure[]
}

export interface LegacyImportExpectation {
  sessionId: string
  fingerprint: string
  entryDigest: string
  entryCount: number
}

export interface ExistingLegacyImport extends LegacyImportExpectation {
  marker?: string
}

export type LegacyImportDecision =
  | { action: 'create' | 'skip' | 'rebuild' }
  | { action: 'conflict'; reason: string }

interface ParsedEntry {
  entry: SessionEntry
  line: number
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('不支持的规范化值')
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const fields = Object.keys(object)
      .sort(compareUnicodeCodePoints)
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    return `{${fields.join(',')}}`
  }
  throw new Error('不支持的规范化值')
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!)
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!
  }
  return leftPoints.length - rightPoints.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && !Number.isNaN(new Date(value).getTime())
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isHeader(value: unknown): value is SessionHeader {
  return (
    isRecord(value) &&
    value.type === 'session' &&
    (value.version === 1 || value.version === 2) &&
    value.kernel === 'pi@0.82' &&
    typeof value.cwd === 'string' &&
    isValidTimestamp(value.createdAt)
  )
}

function isTextContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'text' &&
    typeof value.text === 'string' &&
    isOptionalString(value.textSignature)
  )
}

function isImageContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'image' &&
    typeof value.data === 'string' &&
    typeof value.mimeType === 'string'
  )
}

function isThinkingContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'thinking' &&
    typeof value.thinking === 'string' &&
    isOptionalString(value.thinkingSignature) &&
    isOptionalBoolean(value.redacted)
  )
}

function isToolCall(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'toolCall' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.arguments) &&
    isOptionalString(value.thoughtSignature)
  )
}

function isUsage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cost)) return false
  const cost = value.cost
  const numeric = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const
  const costNumeric = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const
  return (
    numeric.every((key) => isFiniteNumber(value[key])) &&
    costNumeric.every((key) => isFiniteNumber(cost[key])) &&
    (value.cacheWrite1h === undefined || isFiniteNumber(value.cacheWrite1h)) &&
    (value.reasoning === undefined || isFiniteNumber(value.reasoning))
  )
}

function isContentArray(
  value: unknown,
  blockGuard: (block: unknown) => boolean,
): value is unknown[] {
  return Array.isArray(value) && value.every(blockGuard)
}

function isKernelMessage(value: unknown): boolean {
  if (!isRecord(value) || !isValidTimestamp(value.timestamp)) return false
  if (value.role === 'user') {
    return (
      typeof value.content === 'string' ||
      isContentArray(value.content, (block) => isTextContent(block) || isImageContent(block))
    )
  }
  if (value.role === 'assistant') {
    const stopReasons = new Set(['stop', 'length', 'toolUse', 'error', 'aborted'])
    return (
      isContentArray(
        value.content,
        (block) => isTextContent(block) || isThinkingContent(block) || isToolCall(block),
      ) &&
      typeof value.api === 'string' &&
      typeof value.provider === 'string' &&
      typeof value.model === 'string' &&
      typeof value.stopReason === 'string' &&
      stopReasons.has(value.stopReason) &&
      isUsage(value.usage) &&
      isOptionalString(value.responseModel) &&
      isOptionalString(value.responseId) &&
      isOptionalString(value.errorMessage) &&
      (value.diagnostics === undefined ||
        (Array.isArray(value.diagnostics) && value.diagnostics.every(isRecord)))
    )
  }
  if (value.role === 'toolResult') {
    return (
      typeof value.toolCallId === 'string' &&
      typeof value.toolName === 'string' &&
      isContentArray(value.content, (block) => isTextContent(block) || isImageContent(block)) &&
      typeof value.isError === 'boolean' &&
      (value.usage === undefined || isUsage(value.usage)) &&
      (value.addedToolNames === undefined ||
        (Array.isArray(value.addedToolNames) &&
          value.addedToolNames.every((name) => typeof name === 'string')))
    )
  }
  return false
}

function isSessionMessage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !isValidTimestamp(value.createdAt)) {
    return false
  }
  if (value.kind === 'kernel') {
    return (
      isKernelMessage(value.message) &&
      (value.durationMs === undefined || isFiniteNumber(value.durationMs))
    )
  }
  if (value.kind === 'notice') {
    const notices = new Set(['expert_changed', 'mode_changed', 'compaction', 'session_resumed'])
    return (
      typeof value.notice === 'string' &&
      notices.has(value.notice) &&
      typeof value.text === 'string' &&
      typeof value.display === 'boolean'
    )
  }
  return (
    value.kind === 'compaction' &&
    typeof value.summary === 'string' &&
    isFiniteNumber(value.tokensBefore) &&
    isFiniteNumber(value.compactedCount) &&
    typeof value.firstKeptEntryId === 'string'
  )
}

function parseEntry(value: unknown): SessionEntry | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    !isValidTimestamp(value.timestamp)
  ) {
    return undefined
  }
  switch (value.type) {
    case 'message':
      return isSessionMessage(value.message) &&
        isRecord(value.message) &&
        value.message.id === value.id
        ? (value as unknown as SessionEntry)
        : undefined
    case 'model_change':
      return typeof value.channelId === 'string' && typeof value.modelId === 'string'
        ? (value as unknown as SessionEntry)
        : undefined
    case 'compaction':
      return typeof value.summary === 'string' &&
        typeof value.firstKeptEntryId === 'string' &&
        isFiniteNumber(value.tokensBefore) &&
        (value.compactedCount === undefined || isFiniteNumber(value.compactedCount))
        ? (value as unknown as SessionEntry)
        : undefined
    case 'custom':
      return typeof value.key === 'string' ? (value as unknown as SessionEntry) : undefined
    case 'truncate':
      return typeof value.fromId === 'string' ? (value as unknown as SessionEntry) : undefined
    default:
      return undefined
  }
}

function diagnostic(
  input: LegacyParseInput,
  line: number,
  category: LegacyDiagnostic['category'],
  code: string,
  reason: string,
): LegacyDiagnostic {
  return {
    sessionId: input.sessionId,
    relativePath: input.relativePath,
    line,
    category,
    code,
    reason,
  }
}

export function parseLegacySession(input: LegacyParseInput): LegacyParseResult {
  let header: SessionHeader | undefined
  const entries: ParsedEntry[] = []
  const diagnostics: LegacyDiagnostic[] = []
  const ids = new Set<string>()
  const priorMessageIds = new Set<string>()

  for (const [index, rawLine] of input.text.split(/\r?\n/).entries()) {
    const line = index + 1
    if (!rawLine.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(rawLine)
    } catch {
      diagnostics.push(diagnostic(input, line, 'syntax', 'INVALID_JSON', 'JSON 语法错误'))
      continue
    }

    if (!header) {
      if (!isHeader(value)) {
        throw new Error(`${input.relativePath}:${line} 首个合法对象必须是 pi@0.82 v1/v2 header`)
      }
      header = value
      continue
    }

    const entry = parseEntry(value)
    if (!entry) {
      diagnostics.push(diagnostic(input, line, 'schema', 'INVALID_ENTRY', '不属于已知 SessionEntry'))
      continue
    }
    if (ids.has(entry.id)) {
      diagnostics.push(diagnostic(input, line, 'schema', 'DUPLICATE_ID', `entry id 重复: ${entry.id}`))
      continue
    }
    if (
      (entry.type === 'compaction' && !priorMessageIds.has(entry.firstKeptEntryId)) ||
      (entry.type === 'truncate' && !priorMessageIds.has(entry.fromId))
    ) {
      diagnostics.push(
        diagnostic(
          input,
          line,
          'schema',
          'INVALID_REFERENCE',
          `${entry.type} 引用了此前不存在的 message`,
        ),
      )
      continue
    }

    const normalized =
      header.version === 1 && entry.type === 'compaction' && entry.compactedCount === undefined
        ? { ...entry, compactedCount: 0 }
        : entry
    entries.push({ entry: normalized, line })
    ids.add(normalized.id)
    if (normalized.type === 'message') priorMessageIds.add(normalized.id)
  }

  if (!header) throw new Error(`${input.relativePath}:1 缺少 Session header`)
  const parsedEntries = entries.map((item) => item.entry)
  const entryLines = Object.fromEntries(entries.map((item) => [item.entry.id, item.line]))
  const fingerprint = hash(
    input.sessionId +
      canonicalJson(input.indexMeta) +
      canonicalJson(header) +
      parsedEntries.map((entry) => canonicalJson(entry)).join('\n'),
  )
  return {
    sessionId: input.sessionId,
    relativePath: input.relativePath,
    header,
    entries: parsedEntries,
    entryLines,
    diagnostics,
    fingerprint,
  }
}

export function legacyReplayMessageIds(parsed: LegacyParseResult): string[] {
  const lastCompaction = [...parsed.entries]
    .reverse()
    .find(
      (entry): entry is Extract<SessionEntry, { type: 'compaction' }> =>
        entry.type === 'compaction',
    )
  const ids: string[] = []
  const truncateFrom: string[] = []
  let reachedKeptBoundary = !lastCompaction

  if (lastCompaction) ids.push(lastCompaction.id)
  for (const entry of parsed.entries) {
    if (entry.type === 'message') {
      if (lastCompaction && !reachedKeptBoundary) {
        reachedKeptBoundary = entry.id === lastCompaction.firstKeptEntryId
      }
      if (reachedKeptBoundary) ids.push(entry.id)
    } else if (entry.type === 'truncate') {
      truncateFrom.push(entry.fromId)
    }
  }
  let cut = ids.length
  for (const fromId of truncateFrom) {
    const index = ids.indexOf(fromId)
    if (index !== -1 && index < cut) cut = index
  }
  return ids.slice(0, cut)
}

function mappedEntry(
  entry: SessionEntry,
  parentId: string | null,
): PersistedSessionEntry {
  const timestamp = new Date(entry.timestamp).toISOString()
  switch (entry.type) {
    case 'message': {
      if (entry.message.kind === 'kernel') {
        return { type: 'message', id: entry.id, parentId, timestamp, message: entry.message.message }
      }
      if (entry.message.kind === 'notice') {
        return {
          type: 'custom_message',
          id: entry.id,
          parentId,
          timestamp,
          customType: 'tgbuddy.notice',
          content: entry.message.text,
          details: { notice: entry.message.notice },
          display: entry.message.display,
        }
      }
      const message = toKernelMessages([entry.message])[0]
      if (!message) throw new Error(`无法映射 legacy message: ${entry.id}`)
      return { type: 'message', id: entry.id, parentId, timestamp, message }
    }
    case 'model_change':
      return {
        type: 'custom',
        id: entry.id,
        parentId,
        timestamp,
        customType: 'legacy.model_change',
        data: entry,
      }
    case 'compaction':
      return {
        type: 'compaction',
        id: entry.id,
        parentId,
        timestamp,
        summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId,
        tokensBefore: entry.tokensBefore,
        details: { compactedCount: entry.compactedCount ?? 0 },
      }
    case 'custom':
      return {
        type: 'custom',
        id: entry.id,
        parentId,
        timestamp,
        customType: entry.key,
        data: entry.value,
      }
    case 'truncate':
      return {
        type: 'custom',
        id: entry.id,
        parentId,
        timestamp,
        customType: 'legacy.truncate',
        data: entry,
      }
  }
}

function activeMessageIdsFromMapped(entries: PersistedSessionEntry[]): string[] {
  const leaf = [...entries].reverse().find((entry) => entry.type === 'leaf')
  let current = leaf?.type === 'leaf' ? leaf.targetId : entries.at(-1)?.id ?? null
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const path: PersistedSessionEntry[] = []
  while (current) {
    const entry = byId.get(current)
    if (!entry) break
    path.push(entry)
    current = entry.parentId
  }
  path.reverse()
  const compaction = [...path]
    .reverse()
    .find(
      (entry): entry is Extract<PersistedSessionEntry, { type: 'compaction' }> =>
        entry.type === 'compaction',
    )
  let active = path
  if (compaction) {
    const compactionIndex = path.findIndex((entry) => entry.id === compaction.id)
    active = [compaction]
    if (compaction.firstKeptEntryId) {
      const keptIndex = path.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
      if (keptIndex !== -1 && keptIndex < compactionIndex) {
        active.push(...path.slice(keptIndex, compactionIndex))
      }
    }
    active.push(...path.slice(compactionIndex + 1))
  }
  return active
    .filter(
      (entry) =>
        entry.type === 'message' ||
        entry.type === 'custom_message' ||
        entry.type === 'compaction',
    )
    .map((entry) => entry.id)
}

export function mapLegacyEntries(parsed: LegacyParseResult): LegacyMapResult {
  const entries: PersistedSessionEntry[] = []
  const diagnostics = [...parsed.diagnostics]
  const lastCompactionId = [...parsed.entries]
    .reverse()
    .find((entry) => entry.type === 'compaction')?.id
  let parentId: string | null = null

  for (const entry of parsed.entries) {
    const mapped: PersistedSessionEntry =
      entry.type === 'compaction' && entry.id !== lastCompactionId
        ? ({
            type: 'custom',
            id: entry.id,
            parentId,
            timestamp: new Date(entry.timestamp).toISOString(),
            customType: 'legacy.compaction',
            data: entry,
          } satisfies PersistedSessionEntry)
        : mappedEntry(entry, parentId)
    entries.push(mapped)
    parentId = mapped.id
    if (entry.type === 'compaction' && entry.id !== lastCompactionId) {
      diagnostics.push({
        sessionId: parsed.sessionId,
        relativePath: parsed.relativePath,
        line: parsed.entryLines[entry.id] ?? 0,
        category: 'compatibility',
        code: 'SUPERSEDED_COMPACTION_AS_CUSTOM',
        reason: '被后续 compaction 取代的旧边界作为 audit custom entry 保存',
      })
    }
    if (entry.type === 'model_change') {
      diagnostics.push({
        sessionId: parsed.sessionId,
        relativePath: parsed.relativePath,
        line: parsed.entryLines[entry.id] ?? 0,
        category: 'compatibility',
        code: 'CHANNEL_PROVIDER_UNRESOLVED',
        reason: 'model_change.channelId 已保存为 legacy.model_change，未伪装为 provider',
      })
    }
    if (
      entry.type === 'message' &&
      entry.message.kind === 'kernel' &&
      entry.message.durationMs !== undefined
    ) {
      diagnostics.push({
        sessionId: parsed.sessionId,
        relativePath: parsed.relativePath,
        line: parsed.entryLines[entry.id] ?? 0,
        category: 'compatibility',
        code: 'KERNEL_DURATION_UNMAPPED',
        reason: 'KernelMessage.durationMs 不属于 pi Message，已明确记录兼容差异',
      })
    }
    if (entry.type === 'message' && entry.message.kind === 'compaction') {
      diagnostics.push({
        sessionId: parsed.sessionId,
        relativePath: parsed.relativePath,
        line: parsed.entryLines[entry.id] ?? 0,
        category: 'compatibility',
        code: 'COMPACTION_ENVELOPE_METADATA_UNMAPPED',
        reason: '消息内 compaction 的 compactedCount/firstKeptEntryId 无等价 pi Message 字段',
      })
    }
  }

  const truncateTargets = parsed.entries
    .filter((entry): entry is Extract<SessionEntry, { type: 'truncate' }> => entry.type === 'truncate')
    .map((entry) => entry.fromId)
  if (truncateTargets.length > 0) {
    const expectedActive = legacyReplayMessageIds(parsed)
    const compaction = [...entries]
      .reverse()
      .find(
        (entry): entry is Extract<PersistedSessionEntry, { type: 'compaction' }> =>
          entry.type === 'compaction',
      )
    if (
      compaction?.firstKeptEntryId &&
      !expectedActive.includes(compaction.firstKeptEntryId)
    ) {
      const legacyFirstKeptEntryId = compaction.firstKeptEntryId
      const syntheticBoundaryId = hash(
        `${parsed.sessionId}:truncate-compaction-boundary`,
      ).slice(0, 16)
      const mappedCompactionIndex = entries.findIndex(
        (entry) => entry.id === compaction.id,
      )
      entries.splice(mappedCompactionIndex, 0, {
        type: 'custom',
        id: syntheticBoundaryId,
        parentId: null,
        timestamp: compaction.timestamp,
        customType: 'legacy.truncated_compaction_boundary',
        data: { legacyFirstKeptEntryId },
      })
      compaction.parentId = syntheticBoundaryId
      compaction.details = {
        ...(isRecord(compaction.details) ? compaction.details : {}),
        legacyFirstKeptEntryId,
        legacyTruncated: true,
      }
      compaction.firstKeptEntryId = syntheticBoundaryId
    }
    const legacyCompactionIndex = compaction
      ? parsed.entries.findIndex((entry) => entry.id === compaction.id)
      : -1
    const lastExpected = expectedActive.at(-1)
    const lastExpectedIndex = lastExpected
      ? parsed.entries.findIndex((entry) => entry.id === lastExpected)
      : -1
    const targetId =
      compaction && lastExpectedIndex <= legacyCompactionIndex
        ? compaction.id
        : (lastExpected ?? null)
    const leafId = hash(`${parsed.sessionId}:truncate-leaf`).slice(0, 16)
    entries.push({
      type: 'leaf',
      id: leafId,
      parentId,
      timestamp: new Date(
        Math.max(...parsed.entries.map((entry) => entry.timestamp)) + 1,
      ).toISOString(),
      targetId,
    })
  }

  const activeMessageIds = activeMessageIdsFromMapped(entries)
  const expectedActive = legacyReplayMessageIds(parsed)
  if (canonicalJson(activeMessageIds) !== canonicalJson(expectedActive)) {
    throw new Error(
      `legacy active context 映射不一致: expected=${canonicalJson(expectedActive)} actual=${canonicalJson(activeMessageIds)}`,
    )
  }
  const entryDigest = hash(
    entries.map((entry) => canonicalJson({ id: entry.id, type: entry.type })).join('\n'),
  )
  return { entries, diagnostics, activeMessageIds, entryDigest }
}

export function decideLegacyImport(
  existing: ExistingLegacyImport | undefined,
  expected: LegacyImportExpectation,
): LegacyImportDecision {
  if (!existing) return { action: 'create' }
  if (
    existing.marker !== 'tgbuddy-jsonl-v1' ||
    existing.sessionId !== expected.sessionId ||
    existing.fingerprint !== expected.fingerprint
  ) {
    return { action: 'conflict', reason: '已有同 ID Session 不属于本 importer' }
  }
  if (
    existing.entryDigest === expected.entryDigest &&
    existing.entryCount === expected.entryCount &&
    existing.sessionId === expected.sessionId
  ) {
    return { action: 'skip' }
  }
  return { action: 'rebuild' }
}

export function legacySqliteSessionId(sessionId: string): string {
  return `legacy-${hash(sessionId).slice(0, 32)}`
}

/**
 * 只负责读取和验证 legacy 文件，不写 SQLite。
 * 每个 Session 独立失败，单个坏文件不能阻塞其它会话或应用启动。
 */
export async function loadLegacySessionCandidates(
  legacyDataDir: string,
): Promise<LegacyLoadResult> {
  const indexRelativePath = 'sessions.json'
  const indexPath = join(legacyDataDir, indexRelativePath)
  let indexText: string
  try {
    indexText = await readFile(indexPath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { found: false, candidates: [], failures: [] }
    }
    return {
      found: true,
      candidates: [],
      failures: [{
        relativePath: indexRelativePath,
        line: 0,
        category: 'io',
        code: 'READ_INDEX_FAILED',
        reason: errorMessage(error),
      }],
    }
  }

  let indexValue: unknown
  try {
    indexValue = JSON.parse(indexText)
  } catch {
    return {
      found: true,
      candidates: [],
      failures: [{
        relativePath: indexRelativePath,
        line: 0,
        category: 'schema',
        code: 'INVALID_INDEX_JSON',
        reason: 'Session 索引 JSON 语法错误',
      }],
    }
  }
  const records = legacyIndexRecords(indexValue)
  if (!records) {
    return {
      found: true,
      candidates: [],
      failures: [{
        relativePath: indexRelativePath,
        line: 0,
        category: 'schema',
        code: 'INVALID_INDEX_SCHEMA',
        reason: 'Session 索引必须是数组或包含 sessions 数组',
      }],
    }
  }

  const candidates: LegacySessionCandidate[] = []
  const failures: LegacyLoadFailure[] = []
  for (const record of records) {
    const meta = parseLegacySessionMeta(record)
    if (!meta) {
      failures.push({
        relativePath: indexRelativePath,
        line: 0,
        category: 'schema',
        code: 'INVALID_SESSION_META',
        reason: '跳过结构无效的 SessionMeta',
      })
      continue
    }
    const relativePath = `sessions/${meta.id}.jsonl`
    let text: string
    try {
      text = await readFile(join(legacyDataDir, 'sessions', `${meta.id}.jsonl`), 'utf8')
    } catch (error) {
      failures.push({
        sessionId: meta.id,
        relativePath,
        line: 0,
        category: 'io',
        code: 'READ_SESSION_FAILED',
        reason: errorMessage(error),
      })
      continue
    }
    try {
      const parsed = parseLegacySession({
        sessionId: meta.id,
        relativePath,
        indexMeta: record,
        text,
      })
      candidates.push({
        meta,
        parsed,
        mapped: mapLegacyEntries(parsed),
      })
    } catch (error) {
      failures.push({
        sessionId: meta.id,
        relativePath,
        line: errorLine(error),
        category: 'schema',
        code: 'PARSE_SESSION_FAILED',
        reason: errorMessage(error),
      })
    }
  }
  return { found: true, candidates, failures }
}

function legacyIndexRecords(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.sessions)) return value.sessions
  return undefined
}

function parseLegacySessionMeta(value: unknown): SessionMeta | undefined {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !/^[A-Za-z0-9_-]+$/.test(value.id)
    || typeof value.title !== 'string'
    || !isFiniteNumber(value.createdAt)
    || !isFiniteNumber(value.updatedAt)
  ) {
    return undefined
  }
  const permissionMode =
    value.permissionMode === 'plan'
    || value.permissionMode === 'auto'
    || value.permissionMode === 'bypass'
      ? value.permissionMode
      : undefined
  const status =
    value.status === 'idle'
    || value.status === 'running'
    || value.status === 'done'
    || value.status === 'failed'
    || value.status === 'interrupted'
      ? value.status
      : undefined
  const contextUsage = isContextUsage(value.contextUsage)
    ? value.contextUsage
    : undefined
  const originRef = isRecord(value.originRef)
    && typeof value.originRef.sessionId === 'string'
    && typeof value.originRef.messageId === 'string'
    ? {
        sessionId: value.originRef.sessionId,
        messageId: value.originRef.messageId,
      }
    : undefined

  return {
    id: value.id,
    title: value.title,
    ...(optionalString(value.workspaceId, 'workspaceId')),
    ...(optionalString(value.channelId, 'channelId')),
    ...(optionalString(value.modelId, 'modelId')),
    ...(optionalString(value.expertId, 'expertId')),
    ...(typeof value.pinned === 'boolean' ? { pinned: value.pinned } : {}),
    ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(status ? { status } : {}),
    ...(optionalString(value.statusDetail, 'statusDetail')),
    ...(optionalString(value.lastActivity, 'lastActivity')),
    ...(isFiniteNumber(value.artifactCount)
      ? { artifactCount: value.artifactCount }
      : {}),
    ...(contextUsage ? { contextUsage } : {}),
    ...(originRef ? { originRef } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function optionalString<Key extends string>(
  value: unknown,
  key: Key,
): Partial<Record<Key, string>> {
  return typeof value === 'string' ? { [key]: value } as Record<Key, string> : {}
}

function isContextUsage(value: unknown): value is ContextUsage {
  if (!isRecord(value) || !isRecord(value.breakdown)) return false
  return (
    [
      value.usedTokens,
      value.contextWindow,
      value.percent,
      value.outputTokens,
      value.costUsd,
      value.updatedAt,
      value.breakdown.systemPrompt,
      value.breakdown.tools,
      value.breakdown.messages,
      value.breakdown.skills,
      value.breakdown.mcp,
    ].every(isFiniteNumber)
  )
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorLine(error: unknown): number {
  const match = errorMessage(error).match(/:(\d+)\s/)
  return match ? Number(match[1]) : 0
}
