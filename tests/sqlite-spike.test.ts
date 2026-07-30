import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  canonicalJson,
  decideLegacyImport,
  legacyReplayMessageIds,
  mapLegacyEntries,
  parseLegacySession,
} from '../scripts/sqlite-spike-import.ts'
import {
  assertPackagedRuntime,
  resolvePackagedExecutable,
} from '../scripts/sqlite-spike-runtime.ts'

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

  test('按 pi Message union 校验 assistant 和 toolResult', () => {
    const parsed = parseLegacySession({
      sessionId: 'invalid-pi-messages',
      relativePath: 'archive/invalid-pi-messages.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"a1","timestamp":2,"message":{"kind":"kernel","id":"a1","createdAt":2,"message":{"role":"assistant","content":"错误字符串","api":"x","provider":"x","model":"x","usage":{},"stopReason":"whatever","timestamp":2}}}',
        '{"type":"message","id":"r1","timestamp":3,"message":{"kind":"kernel","id":"r1","createdAt":3,"message":{"role":"toolResult","toolCallId":"call","toolName":"tool","content":[{"type":"unknown"}],"isError":false,"timestamp":3}}}',
      ].join('\n'),
    })
    expect(parsed.entries).toEqual([])
    expect(parsed.diagnostics.map((item) => [item.line, item.category])).toEqual([
      [2, 'schema'],
      [3, 'schema'],
    ])
  })

  test('拒绝无效可选字段、notice 枚举和 Date 范围', () => {
    const parsed = parseLegacySession({
      sessionId: 'invalid-optionals',
      relativePath: 'archive/invalid-optionals.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"m1","timestamp":2,"message":{"kind":"kernel","id":"m1","createdAt":2,"message":{"role":"user","content":[{"type":"text","text":"x","textSignature":123}],"timestamp":2}}}',
        '{"type":"message","id":"n1","timestamp":3,"message":{"kind":"notice","id":"n1","createdAt":3,"notice":"unknown_notice","text":"x","display":true}}',
        '{"type":"custom","id":"u1","timestamp":1e300,"key":"x","value":true}',
      ].join('\n'),
    })
    expect(parsed.entries).toEqual([])
    expect(parsed.diagnostics.map((item) => [item.line, item.code])).toEqual([
      [2, 'INVALID_ENTRY'],
      [3, 'INVALID_ENTRY'],
      [4, 'INVALID_ENTRY'],
    ])
  })

  test('无法等价映射的消息信封元数据产生 compatibility warning', () => {
    const parsed = parseLegacySession({
      sessionId: 'envelope-metadata',
      relativePath: 'archive/envelope-metadata.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"m1","timestamp":2,"message":{"kind":"kernel","id":"m1","createdAt":2,"durationMs":42,"message":{"role":"user","content":"x","timestamp":2}}}',
        '{"type":"message","id":"q1","timestamp":3,"message":{"kind":"compaction","id":"q1","createdAt":3,"summary":"摘要","compactedCount":2,"tokensBefore":10,"firstKeptEntryId":"m1"}}',
      ].join('\n'),
    })
    const codes = mapLegacyEntries(parsed).diagnostics
      .filter((item) => item.category === 'compatibility')
      .map((item) => [item.line, item.code])
    expect(codes).toEqual([
      [2, 'KERNEL_DURATION_UNMAPPED'],
      [3, 'COMPACTION_ENVELOPE_METADATA_UNMAPPED'],
    ])
  })

  test('拒绝 entry ID 与消息信封 ID 不一致', () => {
    const parsed = parseLegacySession({
      sessionId: 'mismatched-id',
      relativePath: 'archive/mismatched-id.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"outer","timestamp":2,"message":{"kind":"kernel","id":"inner","createdAt":2,"message":{"role":"user","content":[{"type":"text","text":"消息"}],"timestamp":2}}}',
        '{"type":"truncate","id":"t1","timestamp":3,"fromId":"outer"}',
      ].join('\n'),
    })
    expect(parsed.entries).toEqual([])
    expect(parsed.diagnostics.map((item) => [item.line, item.code])).toEqual([
      [2, 'INVALID_ENTRY'],
      [3, 'INVALID_REFERENCE'],
    ])
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

  test('多次 compaction 只让最后一次进入 active context', () => {
    const parsed = parseLegacySession({
      sessionId: 'multiple-compactions',
      relativePath: 'archive/multiple-compactions.jsonl',
      indexMeta: {},
      text: [
        '{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\\\fixture","createdAt":1}',
        '{"type":"message","id":"m1","timestamp":2,"message":{"kind":"kernel","id":"m1","createdAt":2,"message":{"role":"user","content":"旧","timestamp":2}}}',
        '{"type":"message","id":"m2","timestamp":3,"message":{"kind":"kernel","id":"m2","createdAt":3,"message":{"role":"user","content":"保留","timestamp":3}}}',
        '{"type":"compaction","id":"c1","timestamp":4,"summary":"旧摘要","firstKeptEntryId":"m2","tokensBefore":80,"compactedCount":1}',
        '{"type":"message","id":"m3","timestamp":5,"message":{"kind":"kernel","id":"m3","createdAt":5,"message":{"role":"user","content":"新","timestamp":5}}}',
        '{"type":"compaction","id":"c2","timestamp":6,"summary":"新摘要","firstKeptEntryId":"m2","tokensBefore":100,"compactedCount":2}',
      ].join('\n'),
    })
    const mapped = mapLegacyEntries(parsed)
    expect(mapped.activeMessageIds).toEqual(['c2', 'm2', 'm3'])
    expect(mapped.entries.find((entry) => entry.id === 'c1')).toMatchObject({
      type: 'custom',
      customType: 'legacy.compaction',
    })
    expect(mapped.diagnostics).toContainEqual(
      expect.objectContaining({ line: 4, code: 'SUPERSEDED_COMPACTION_AS_CUSTOM' }),
    )
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

describe('SQLite Spike packaged runtime', () => {
  test('runtime gate 拒绝开发 Electron 和错误版本', () => {
    expect(() =>
      assertPackagedRuntime({
        isPackaged: false,
        defaultApp: true,
        appPath: 'C:\\repo',
        electron: '39.8.10',
        node: '22.22.1',
        sqlite: '3.51.2',
        hasDatabaseSync: true,
        hasBackup: true,
        electronRunAsNode: false,
      }),
    ).toThrow('必须从 packaged Electron 运行')
  })

  test('按平台解析 packaged 可执行文件', () => {
    expect(resolvePackagedExecutable('C:\\out\\TgBuddySQLiteSpike-win32-x64', 'win32')).toBe(
      'C:\\out\\TgBuddySQLiteSpike-win32-x64\\TgBuddySQLiteSpike.exe',
    )
  })
})
