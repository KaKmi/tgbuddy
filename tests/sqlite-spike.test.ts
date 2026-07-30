import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalJson,
  decideLegacyImport,
  legacyReplayMessageIds,
  loadLegacySessionCandidates,
  mapLegacyEntries,
  parseLegacySession,
} from '../src/infrastructure/sqlite/legacy-importer.ts'
import {
  assertCompleteSpikeReport,
  assertPackagedRuntime,
  renderEvidence,
  resolvePackagedExecutable,
  type RuntimeSnapshot,
  type SpikeReport,
} from '../scripts/sqlite-spike-runtime.ts'
import {
  assertContinuousPrefix,
  validateCheckpointResult,
} from '../scripts/sqlite-spike-scenarios.ts'

describe('SQLite Spike legacy importer', () => {
  test('逐会话加载，坏索引项和缺失文件不阻塞有效会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tgbuddy-legacy-loader-'))
    const sessionsRoot = join(root, 'sessions')
    try {
      await mkdir(sessionsRoot, { recursive: true })
      await writeFile(
        join(root, 'sessions.json'),
        JSON.stringify({
          sessions: [
            {
              id: 'legacy-a',
              title: '可导入会话',
              pinned: true,
              createdAt: 1700000000000,
              updatedAt: 1700000009000,
            },
            {
              id: 'legacy-missing',
              title: '文件缺失',
              createdAt: 1700000010000,
              updatedAt: 1700000011000,
            },
            { id: 'invalid-meta' },
            {
              id: '../outside',
              title: '越界路径',
              createdAt: 1700000020000,
              updatedAt: 1700000021000,
            },
          ],
        }),
        'utf8',
      )
      await writeFile(
        join(sessionsRoot, 'legacy-a.jsonl'),
        await readFile('tests/fixtures/legacy-session.jsonl', 'utf8'),
        'utf8',
      )

      const loaded = await loadLegacySessionCandidates(root)

      expect(loaded.found).toBe(true)
      expect(loaded.candidates).toHaveLength(1)
      expect(loaded.candidates[0]?.meta).toMatchObject({
        id: 'legacy-a',
        title: '可导入会话',
        pinned: true,
      })
      expect(
        loaded.candidates[0]?.mapped.diagnostics
          .filter((item) => item.category === 'syntax' || item.category === 'schema')
          .map((item) => [item.line, item.category]),
      ).toEqual([[12, 'syntax'], [13, 'schema']])
      expect(loaded.failures).toHaveLength(3)
      expect(loaded.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'legacy-missing',
            relativePath: 'sessions/legacy-missing.jsonl',
            line: 0,
            code: 'READ_SESSION_FAILED',
          }),
          expect.objectContaining({
            relativePath: 'sessions.json',
            line: 0,
            code: 'INVALID_SESSION_META',
          }),
        ]),
      )
      expect(loaded.failures.every((item) => item.reason.length > 0)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

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
      details: {
        legacyFirstKeptEntryId: 'm2',
        legacyTruncated: true,
      },
    })
    expect(mapped.entries).toContainEqual(
      expect.objectContaining({
        type: 'custom',
        customType: 'legacy.truncated_compaction_boundary',
        parentId: null,
      }),
    )
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

  test('连续前缀拒绝空洞和重复', () => {
    const messages = [
      {
        type: 'message',
        id: 'a',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: user('crash-0'),
      },
      {
        type: 'message',
        id: 'b',
        parentId: 'a',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: user('crash-2'),
      },
    ] satisfies import('@earendil-works/pi-agent-core').SessionTreeEntry[]
    expect(() => assertContinuousPrefix(messages, 'crash-', 1, 10)).toThrow(
      '业务序号不是连续前缀',
    )
  })

  test('checkpoint 必须无 busy 且完成 checkpoint', () => {
    expect(() =>
      validateCheckpointResult({ busy: 1, log: 10, checkpointed: 4 }),
    ).toThrow('WAL checkpoint busy=1')
  })

  test('完整报告缺少 crash 或 import 场景时失败', () => {
    expect(() =>
      assertCompleteSpikeReport({
        runtime: validRuntime(),
        scenarios: [
          {
            name: 'runtime',
            durationMs: 1,
            assertions: 1,
            entryCount: 0,
            databaseBytes: 0,
            walBytes: 0,
            status: 'passed',
          },
        ],
        status: 'passed',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
      }),
    ).toThrow('缺少必需场景: crash-recovery')
  })

  test('evidence 不泄漏 runtime 绝对路径', () => {
    const report = completeReport()
    assertCompleteSpikeReport(report)
    const evidence = renderEvidence(report)
    expect(evidence).not.toContain('C:\\Users\\Alice')
    expect(evidence).toContain('- ASAR: true')
    expect(evidence.match(/\| passed \|/g)?.length).toBe(12)
  })
})

function validRuntime(): RuntimeSnapshot {
  return {
    isPackaged: true,
    defaultApp: false,
    appPath: 'C:\\Users\\Alice\\App\\resources\\app.asar',
    electron: '39.8.10',
    node: '22.22.1',
    sqlite: '3.51.2',
    hasDatabaseSync: true,
    hasBackup: true,
    electronRunAsNode: false,
  }
}

function completeReport(): SpikeReport {
  const names = [
    'runtime',
    'app-database',
    'session-catalog',
    'pi-session-store',
    'bootstrap',
    'ordered-entries',
    'session-isolation',
    'crash-recovery',
    'compaction',
    'delete-cleanup',
    'wal-backup-restore',
    'legacy-import',
  ]
  return {
    runtime: validRuntime(),
    scenarios: names.map((name) => ({
      name,
      durationMs: 1,
      assertions: 1,
      entryCount: 0,
      databaseBytes: 1,
      walBytes: 0,
      status: 'passed',
    })),
    status: 'passed',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
  }
}

function user(text: string) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    timestamp: 1,
  }
}
