import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  decideLegacyImport,
  legacyReplayMessageIds,
  mapLegacyEntries,
  parseLegacySession,
} from '../scripts/sqlite-spike-import.ts'

describe('SQLite Spike legacy importer', () => {
  test('逐行诊断并映射所有当前类型', async () => {
    const text = await readFile('tests/fixtures/legacy-session.jsonl', 'utf8')
    const parsed = parseLegacySession({
      sessionId: 'legacy-a',
      relativePath: 'sessions/legacy-a.jsonl',
      indexMeta: { id: 'legacy-a', cwd: 'C:\\fixture\\workspace' },
      text,
    })
    expect(parsed.header.version).toBe(2)
    expect(parsed.diagnostics.map((item) => [item.line, item.category])).toEqual([
      [12, 'syntax'],
      [13, 'schema'],
    ])

    const mapped = mapLegacyEntries(parsed)
    expect(mapped.entries.map((entry) => entry.type)).toEqual([
      'message',
      'custom_message',
      'custom',
      'message',
      'compaction',
      'message',
      'custom',
      'message',
      'custom',
      'message',
      'leaf',
    ])
    expect(mapped.diagnostics.some((item) => item.code === 'CHANNEL_PROVIDER_UNRESOLVED')).toBe(true)
    expect(legacyReplayMessageIds(parsed)).toEqual(['c0000001', 'm0000002', 'q0000001'])
    expect(mapped.activeMessageIds).toEqual(['c0000001', 'm0000002', 'q0000001'])
  })

  test('幂等决策区分 skip、半成品重建和冲突', () => {
    const expected = {
      sessionId: 'legacy-a',
      fingerprint: 'abc',
      entryDigest: 'def',
      entryCount: 11,
    }
    expect(decideLegacyImport(undefined, expected)).toEqual({ action: 'create' })
    expect(decideLegacyImport({ marker: 'tgbuddy-jsonl-v1', ...expected }, expected)).toEqual({
      action: 'skip',
    })
    expect(
      decideLegacyImport(
        { marker: 'tgbuddy-jsonl-v1', ...expected, entryDigest: 'partial', entryCount: 4 },
        expected,
      ),
    ).toEqual({ action: 'rebuild' })
    expect(
      decideLegacyImport({ marker: undefined, ...expected, fingerprint: 'other' }, expected),
    ).toEqual({ action: 'conflict', reason: '已有同 ID Session 不属于本 importer' })
  })
})
