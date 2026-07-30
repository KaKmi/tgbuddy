import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  canonicalJson,
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
    expect(
      decideLegacyImport(
        {
          marker: 'tgbuddy-jsonl-v1',
          ...expected,
          sessionId: '另一个会话',
          entryDigest: 'partial',
          entryCount: 1,
        },
        expected,
      ),
    ).toEqual({ action: 'conflict', reason: '已有同 ID Session 不属于本 importer' })
  })

  test('拒绝缺少 content 的 kernel message', () => {
    const parsed = parseLegacySession({
      sessionId: 'invalid-message',
      relativePath: 'archive/invalid-message.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"m1","timestamp":2,"message":{"kind":"kernel","id":"m1","createdAt":2,"message":{"role":"user","timestamp":2}}}',
      ].join('\n'),
    })
    expect(parsed.entries).toEqual([])
    expect(parsed.diagnostics.map((item) => [item.line, item.category])).toEqual([[2, 'schema']])
  })

  test('truncate 可以裁剪 compaction 的 first kept message', () => {
    const parsed = parseLegacySession({
      sessionId: 'truncate-compaction',
      relativePath: 'archive/truncate-compaction.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"m1","timestamp":2,"message":{"kind":"kernel","id":"m1","createdAt":2,"message":{"role":"user","content":[{"type":"text","text":"旧"}],"timestamp":2}}}',
        '{"type":"message","id":"m2","timestamp":3,"message":{"kind":"kernel","id":"m2","createdAt":3,"message":{"role":"user","content":[{"type":"text","text":"保留"}],"timestamp":3}}}',
        '{"type":"compaction","id":"c1","timestamp":4,"summary":"摘要","firstKeptEntryId":"m2","tokensBefore":100,"compactedCount":1}',
        '{"type":"truncate","id":"t1","timestamp":5,"fromId":"m2"}',
      ].join('\n'),
    })
    const mapped = mapLegacyEntries(parsed)
    expect(mapped.activeMessageIds).toEqual(['c1'])
    expect(mapped.entries.at(-1)).toMatchObject({ type: 'leaf', targetId: 'c1' })
    expect(mapped.entries.find((entry) => entry.id === 'c1')).toMatchObject({
      type: 'compaction',
      firstKeptEntryId: undefined,
    })
  })

  test('compatibility 诊断保留真实文件和行号', () => {
    const parsed = parseLegacySession({
      sessionId: 'model-change',
      relativePath: 'archive/custom.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"model_change","id":"d1","timestamp":2,"channelId":"channel","modelId":"model"}',
      ].join('\n'),
    })
    const warning = mapLegacyEntries(parsed).diagnostics.find(
      (item) => item.code === 'CHANNEL_PROVIDER_UNRESOLVED',
    )
    expect(warning).toMatchObject({ relativePath: 'archive/custom.jsonl', line: 2 })
  })

  test('canonicalJson 按 Unicode code point 排序对象键', () => {
    expect(canonicalJson({ '\uE000': 1, '😀': 2 })).toBe('{"":1,"😀":2}')
  })
})
