import { createHash } from 'node:crypto'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import { toKernelMessages } from '../src/shared/types/message.ts'
import type { SessionEntry, SessionHeader } from '../src/shared/types/session.ts'

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
  header: SessionHeader
  entries: SessionEntry[]
  diagnostics: LegacyDiagnostic[]
  fingerprint: string
}

export interface LegacyMapResult {
  entries: SessionTreeEntry[]
  diagnostics: LegacyDiagnostic[]
  activeMessageIds: string[]
  entryDigest: string
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

function isHeader(value: unknown): value is SessionHeader {
  return (
    isRecord(value) &&
    value.type === 'session' &&
    (value.version === 1 || value.version === 2) &&
    value.kernel === 'pi@0.82' &&
    typeof value.cwd === 'string' &&
    isFiniteNumber(value.createdAt)
  )
}

function isSessionMessage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !isFiniteNumber(value.createdAt)) {
    return false
  }
  if (value.kind === 'kernel') return isRecord(value.message) && typeof value.message.role === 'string'
  if (value.kind === 'notice') {
    return typeof value.notice === 'string' && typeof value.text === 'string' && typeof value.display === 'boolean'
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
    !isFiniteNumber(value.timestamp)
  ) {
    return undefined
  }
  switch (value.type) {
    case 'message':
      return isSessionMessage(value.message) ? (value as unknown as SessionEntry) : undefined
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
  const fingerprint = hash(
    input.sessionId +
      canonicalJson(input.indexMeta) +
      canonicalJson(header) +
      parsedEntries.map((entry) => canonicalJson(entry)).join('\n'),
  )
  return { sessionId: input.sessionId, header, entries: parsedEntries, diagnostics, fingerprint }
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

function mappedEntry(entry: SessionEntry, parentId: string | null): SessionTreeEntry {
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

function activeMessageIdsFromMapped(entries: SessionTreeEntry[]): string[] {
  const leaf = [...entries].reverse().find((entry) => entry.type === 'leaf')
  let current = leaf?.type === 'leaf' ? leaf.targetId : entries.at(-1)?.id ?? null
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const path: SessionTreeEntry[] = []
  while (current) {
    const entry = byId.get(current)
    if (!entry) break
    path.push(entry)
    current = entry.parentId
  }
  path.reverse()
  const lastCompaction = [...path].reverse().find((entry) => entry.type === 'compaction')
  const active = lastCompaction
    ? path.slice(path.findIndex((entry) => entry.id === lastCompaction.id))
    : path
  const ids: string[] = []
  if (lastCompaction) ids.push(lastCompaction.id)
  const firstKept =
    lastCompaction?.type === 'compaction' ? lastCompaction.firstKeptEntryId : undefined
  if (firstKept) {
    const kept = path.find((entry) => entry.id === firstKept)
    if (kept && !ids.includes(kept.id)) ids.push(kept.id)
  }
  for (const entry of active) {
    if (entry.type === 'message' && !ids.includes(entry.id)) ids.push(entry.id)
  }
  return ids
}

export function mapLegacyEntries(parsed: LegacyParseResult): LegacyMapResult {
  const entries: SessionTreeEntry[] = []
  const diagnostics = [...parsed.diagnostics]
  let parentId: string | null = null

  for (const entry of parsed.entries) {
    const mapped = mappedEntry(entry, parentId)
    entries.push(mapped)
    parentId = mapped.id
    if (entry.type === 'model_change') {
      diagnostics.push({
        sessionId: parsed.sessionId,
        relativePath: parsed.diagnostics[0]?.relativePath ?? `sessions/${parsed.sessionId}.jsonl`,
        line: 0,
        category: 'compatibility',
        code: 'CHANNEL_PROVIDER_UNRESOLVED',
        reason: 'model_change.channelId 已保存为 legacy.model_change，未伪装为 provider',
      })
    }
  }

  const truncateTargets = parsed.entries
    .filter((entry): entry is Extract<SessionEntry, { type: 'truncate' }> => entry.type === 'truncate')
    .map((entry) => entry.fromId)
  if (truncateTargets.length > 0) {
    let earliestIndex = Number.POSITIVE_INFINITY
    let predecessor: string | null = null
    for (const target of truncateTargets) {
      const index = parsed.entries.findIndex((entry) => entry.id === target)
      if (index !== -1 && index < earliestIndex) {
        earliestIndex = index
        predecessor = index === 0 ? null : parsed.entries[index - 1]!.id
      }
    }
    const leafId = hash(`${parsed.sessionId}:truncate-leaf`).slice(0, 16)
    entries.push({
      type: 'leaf',
      id: leafId,
      parentId,
      timestamp: new Date(
        Math.max(...parsed.entries.map((entry) => entry.timestamp)) + 1,
      ).toISOString(),
      targetId: predecessor,
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
  if (existing.marker !== 'tgbuddy-jsonl-v1' || existing.fingerprint !== expected.fingerprint) {
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
