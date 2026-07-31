# SQLite Packaged Electron Spike Implementation Plan

> **For agentic workers:** Use /ship:dev to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 构建一个与产品入口隔离的 packaged Electron SQLite Spike，用可重复证据裁决 pi SQLite backend 是否能成为 TgBuddy 后续 canonical storage。

**Architecture:** Node launcher 先编译 Spike，再用 Electron Packager 生成启用 ASAR 的临时目录产物；所有功能断言在 packaged Electron 主进程或它派生的同一可执行文件内执行。测试只写 OS temp，使用真实 `SqliteSessionRepo`/`Session` 契约；legacy importer 独立成纯解析映射模块，再由 packaged 场景验证 SQLite 幂等落库。

**Tech Stack:** Bun 1.3、TypeScript 5、esbuild、Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）、`@electron/packager@20.0.4`、`@earendil-works/pi-agent-core@0.82.1`、`@earendil-works/pi-storage-sqlite-node@0.82.1`、`node:sqlite`。

## Global Constraints

- 基线固定为 `main@4735c9da87d5a8a65e074175b34562efaff4dd83`；保留工作树中与本任务无关的用户改动。
- 注释、测试名称、诊断和证据文档一律中文，保留必要英文术语。
- 不修改 `src/main/session-store.ts`、`src/main/ipc.ts`、`src/main/orchestrator.ts`、`src/preload/**`、`src/renderer/**` 或真实 `~/.tgbuddy`。
- pi 的运行时调用只能留在 `scripts/**` 的 Spike 边界内；不得把 SQLite backend 接入生产 `src/main/**`。
- `@earendil-works/pi-storage-sqlite-node` 必须精确为 `0.82.1`，`@electron/packager` 必须精确为 `20.0.4`，两者只加入 root `devDependencies`；`@types/node` 必须从 Node 20 声明升级并精确为 `22.20.1`，覆盖 Electron Node 22 的 `node:sqlite`/`backup` API。
- 不改变现有 Electron `^39.0.0` 声明；Packager 使用 `electron/package.json` 当前锁定的 `39.8.10`，packaged runtime 必须报告同一版本。
- 最终验收必须满足 `app.isPackaged === true`、`process.defaultApp !== true`、`app.getAppPath()` 指向 `app.asar`、未设置 `ELECTRON_RUN_AS_NODE`。
- Bun、系统 Node、`electron .` 和 `ELECTRON_RUN_AS_NODE=1` 只能编排或预检，不能承载 SQLite/Repo/Session 验收断言。
- 所有场景只使用 `mkdtemp()` 创建的 OS temp 根；成功时清理，失败时保留路径并写入报告。
- 业务写入只通过 `SqliteSessionRepo`、`Session` 或导入时的 `SessionStorage.appendEntry()`；原始 SQL 只允许 schema/PRAGMA/integrity/checkpoint/backup 审计。
- 每个 Session storage 必须通过类型守卫确认并 `await cleanup()`；不得用固定长 sleep 掩盖文件锁。
- crash 必须强制终止同一个 packaged 可执行文件；正常 `app.exit()`、抛异常或手写损坏 DB 都不算 crash recovery。
- 活跃 WAL 数据库不得用 `copyFile()` 备份；必须 `wal_checkpoint(TRUNCATE)` 返回 `busy=0` 后调用 `node:sqlite.backup()`。
- legacy importer 必须覆盖 `message/model_change/compaction/custom/truncate` 和 `kernel/notice/compaction` message 子类型；未知类型、语法坏行和语义坏行必须给出 1-based 行号诊断。
- `model_change.channelId` 不得伪装成 pi provider；保存为 `legacy.model_change` custom entry 并报告 compatibility warning。
- `truncate` 的 active context 必须与 `src/main/session-store.ts:162-205` 的“最早截断点统一裁剪”一致；不得用逐条 leaf 导航改变后续消息语义。
- 永远不用 `any`；对象类型优先 `interface`；仅类型导入使用 `import type`。
- 完成标准包括 `bun run typecheck`、`bun test`、`bun run build` 和 `bun run spike:sqlite` 全部通过。

## File Map

- Modify `package.json`：增加 Spike build/run scripts 和两个精确 devDependencies。
- Modify `bun.lock`：由 Bun 锁定新增 devDependencies。
- Create `scripts/sqlite-spike.ts`：Node launcher、临时 staging、Packager、产物启动、报告读取和清理。
- Create `scripts/sqlite-spike-main.ts`：packaged Electron 无窗口入口、父/child 模式分发、最终退出码。
- Create `scripts/sqlite-spike-runtime.ts`：runtime 断言、Repo factory、cleanup guard、报告类型和通用断言。
- Create `scripts/sqlite-spike-scenarios.ts`：bootstrap、顺序/隔离、compaction、delete/cleanup、WAL backup/restore、crash recovery 场景。
- Create `scripts/sqlite-spike-import.ts`：legacy 逐行解析、全类型映射、fingerprint、幂等决策和 SQLite 导入。
- Create `tests/sqlite-spike.test.ts`：纯解析/映射/诊断/幂等/报告断言，不启动 Electron。
- Create `tests/fixtures/legacy-sessions.json`：单会话 legacy 索引元数据。
- Create `tests/fixtures/legacy-session.jsonl`：全类型、语法坏行、语义坏行 fixture。
- Create `.ship/tasks/sqlite-packaged-electron-spike/evidence/README.md`：稳定命令、运行版本、场景结果和已知兼容警告。

---

### Task 1: 固定依赖并完成 legacy 纯解析与映射

**Files:**

- Modify: `package.json:8-19,38-52`
- Modify: `bun.lock`
- Create: `scripts/sqlite-spike-import.ts`
- Create: `tests/sqlite-spike.test.ts`
- Create: `tests/fixtures/legacy-sessions.json`
- Create: `tests/fixtures/legacy-session.jsonl`

**Interfaces:**

- Consumes:
  - `SessionHeader`、`SessionEntry` from `src/shared/types/session.ts`
  - `SessionTreeEntry` from `@earendil-works/pi-agent-core`
- Produces:
  - `parseLegacySession(input: LegacyParseInput): LegacyParseResult`
  - `mapLegacyEntries(parsed: LegacyParseResult): LegacyMapResult`
  - `decideLegacyImport(existing: ExistingLegacyImport | undefined, expected: LegacyImportExpectation): LegacyImportDecision`
  - `legacyReplayMessageIds(parsed: LegacyParseResult): string[]`
  - `canonicalJson(value: unknown): string`

**Tier:** judgment

- [ ] **Step 1: 写完整 fixture 和失败测试**

`tests/fixtures/legacy-sessions.json` 固定为：

```json
[
  {
    "id": "legacy-a",
    "title": "旧会话",
    "cwd": "C:\\fixture\\workspace",
    "createdAt": 1700000000000,
    "updatedAt": 1700000009000
  }
]
```

`tests/fixtures/legacy-session.jsonl` 依次包含：

```jsonl
{"type":"session","version":2,"kernel":"pi@0.82","cwd":"C:\\fixture\\workspace","createdAt":1700000000000}
{"type":"message","id":"m0000001","timestamp":1700000001000,"message":{"kind":"kernel","id":"m0000001","createdAt":1700000001000,"message":{"role":"user","content":[{"type":"text","text":"旧问题"}],"timestamp":1700000001000}}}
{"type":"message","id":"n0000001","timestamp":1700000002000,"message":{"kind":"notice","id":"n0000001","createdAt":1700000002000,"notice":"mode_changed","text":"进入计划模式","display":true}}
{"type":"model_change","id":"d0000001","timestamp":1700000003000,"channelId":"deepseek-primary","modelId":"deepseek-chat"}
{"type":"message","id":"m0000002","timestamp":1700000004000,"message":{"kind":"kernel","id":"m0000002","createdAt":1700000004000,"message":{"role":"user","content":[{"type":"text","text":"保留消息"}],"timestamp":1700000004000}}}
{"type":"compaction","id":"c0000001","timestamp":1700000005000,"summary":"旧摘要","firstKeptEntryId":"m0000002","tokensBefore":12000,"compactedCount":3}
{"type":"message","id":"q0000001","timestamp":1700000006000,"message":{"kind":"compaction","id":"q0000001","createdAt":1700000006000,"summary":"消息内摘要","compactedCount":2,"tokensBefore":8000,"firstKeptEntryId":"m0000002"}}
{"type":"custom","id":"u0000001","timestamp":1700000007000,"key":"plan_state","value":{"phase":"approved"}}
{"type":"message","id":"m0000003","timestamp":1700000008000,"message":{"kind":"kernel","id":"m0000003","createdAt":1700000008000,"message":{"role":"user","content":[{"type":"text","text":"应被截断"}],"timestamp":1700000008000}}}
{"type":"truncate","id":"t0000001","timestamp":1700000009000,"fromId":"m0000003"}
{"type":"message","id":"m0000004","timestamp":1700000010000,"message":{"kind":"kernel","id":"m0000004","createdAt":1700000010000,"message":{"role":"user","content":[{"type":"text","text":"截断后也不应进入旧重放"}],"timestamp":1700000010000}}}
{"type":"message","id":
{"type":"unknown","id":"x0000001","timestamp":1700000011000}
```

`tests/sqlite-spike.test.ts` 写完整断言：

```ts
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
    const expected = { sessionId: 'legacy-a', fingerprint: 'abc', entryDigest: 'def', entryCount: 11 }
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: FAIL，错误包含 `Cannot find module '../scripts/sqlite-spike-import.ts'`。

- [ ] **Step 3: 增加精确 devDependencies**

执行：

```powershell
bun add --dev --exact @electron/packager@20.0.4 @earendil-works/pi-storage-sqlite-node@0.82.1 @types/node@22.20.1
```

Expected: exit 0；`package.json` 三个版本均为精确值且 `bun.lock` 更新。

确认 `dependencies` 仍只有原有生产依赖，新增包只出现在 `devDependencies`。

- [ ] **Step 4: 实现纯解析、映射和幂等决策**

`scripts/sqlite-spike-import.ts` 使用以下公开类型：

```ts
import { createHash } from 'node:crypto'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
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

export function canonicalJson(value: unknown): string
```

关键逻辑必须逐项实现：

1. 第一个非空合法对象必须是 header；只接受 `version === 1 || version === 2` 和 `kernel === 'pi@0.82'`，其它版本抛出带文件/行号的错误；v1 缺失 `compactedCount` 时按 0。
2. JSON 语法错误记录 `syntax`；合法 JSON 但不属于 `SessionEntry` 全集记录 `schema`；两者都不进入 `entries`。entry id 必须非空且在文件内唯一，timestamp 必须为有限数值；compaction 的 `firstKeptEntryId` 和 truncate 的 `fromId` 必须指向此前合法 message，否则记录带行号的 `schema` 并跳过该 entry。
3. `canonicalJson()` 对 `undefined`/非有限 number 编码为 `null`，其它 primitive 使用 `JSON.stringify`；数组保持原顺序并递归处理，对象键按 Unicode code point 升序排序后递归处理，`undefined` 对象字段与 `JSON.stringify` 一样省略；遇到 bigint/function/symbol 抛 `不支持的规范化值`。fingerprint 使用 `sha256(sessionId + canonicalJson(indexMeta) + canonicalJson(header) + entries.map(canonicalJson).join('\n'))`。语法坏行文本不进入 fingerprint。
4. 每个映射 entry 保留 legacy id，`timestamp` 转 `new Date(timestamp).toISOString()`，`parentId` 指向当前 active leaf。
5. kernel → message；notice → `custom_message/tgbuddy.notice`；顶层 compaction → compaction；message.kind=compaction → message entry，message 内容使用 `toKernelMessages([legacyMessage])[0]` 得到 `compactionSummary`；custom → custom。这样保留当前重放中“顶层压缩边界 + 消息内摘要”的区别。
6. model_change → `customType='legacy.model_change'`、data 保存完整原 entry，并追加 `CHANNEL_PROVIDER_UNRESOLVED` compatibility 诊断。
7. truncate → `customType='legacy.truncate'` 保存完整原 entry；全部映射完成后，根据最早有效 `fromId` 的前驱追加一个稳定 ID（`sha256(sessionId + ':truncate-leaf').slice(0, 16)`）的 leaf entry。
8. `legacyReplayMessageIds()` 必须复现 `src/main/session-store.ts:162-205`：最后 compaction + first kept boundary，再应用最早 truncate 裁剪。
9. `mapLegacyEntries().activeMessageIds` 从 mapped active branch 计算，并与 legacy replay 结果相同；不相同直接抛错。
10. `decideLegacyImport()` 只允许带 marker `tgbuddy-jsonl-v1` 且 fingerprint 相同的半成品 rebuild；其它同 ID 状态 conflict。

- [ ] **Step 5: 运行纯测试和类型检查**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: 2 tests PASS。

Run: `bun run typecheck`

Expected: exit 0，无 TypeScript error。

- [ ] **Step 6: 提交**

```powershell
git add package.json bun.lock scripts/sqlite-spike-import.ts tests/sqlite-spike.test.ts tests/fixtures/legacy-sessions.json tests/fixtures/legacy-session.jsonl
git commit -m "test: define sqlite spike legacy import contract"
```

Expected: 创建一个只包含 Task 1 文件的 commit；`git status --short` 中用户原有 README/docs 改动仍未暂存。

---

### Task 2: 生成真正 packaged 的无窗口 Electron runtime

**Files:**

- Create: `scripts/sqlite-spike.ts`
- Create: `scripts/sqlite-spike-main.ts`
- Create: `scripts/sqlite-spike-runtime.ts`
- Create: `scripts/sqlite-spike-scenarios.ts`
- Modify: `package.json:8-19`
- Modify: `tests/sqlite-spike.test.ts`

**Interfaces:**

- Consumes:
  - named export `packager(options): Promise<string[]>` from `@electron/packager`
  - `NodeExecutionEnv` from `@earendil-works/pi-agent-core/node`
  - `SqliteSessionRepo`、`createNodeSqliteFactory` from `@earendil-works/pi-storage-sqlite-node`
- Produces:
  - `packageAndRunSpike(options: SpikeLaunchOptions): Promise<SpikeLaunchResult>`
  - `assertPackagedRuntime(snapshot: RuntimeSnapshot): void`
  - `resolvePackagedExecutable(outputDir: string, platform: NodeJS.Platform): string`
  - `createSpikeRepo(databasePath: string, cwd: string): SpikeRepoContext`
  - `cleanupSession(session: Session): Promise<void>`
  - `runRuntimeScenario(context: ScenarioContext): Promise<ScenarioResult>`
  - `runBootstrapScenario(context: ScenarioContext): Promise<ScenarioResult>`

**Tier:** judgment

- [ ] **Step 1: 写 runtime helper 的失败测试**

在 `tests/sqlite-spike.test.ts` 追加：

```ts
import { assertPackagedRuntime, resolvePackagedExecutable } from '../scripts/sqlite-spike-runtime.ts'

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: FAIL，错误包含 `Cannot find module '../scripts/sqlite-spike-runtime.ts'`。

- [ ] **Step 3: 实现 runtime contract 和无窗口入口**

先在 `package.json` scripts 增加：

```json
{
  "build:sqlite-spike": "esbuild scripts/sqlite-spike.ts scripts/sqlite-spike-main.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/sqlite-spike --sourcemap",
  "spike:sqlite": "bun run build:sqlite-spike && node dist/sqlite-spike/sqlite-spike.js"
}
```

`scripts/sqlite-spike-runtime.ts` 定义：

```ts
import type { Session } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node'

export interface RuntimeSnapshot {
  isPackaged: boolean
  defaultApp: boolean
  appPath: string
  electron: string
  node: string
  sqlite: string
  hasDatabaseSync: boolean
  hasBackup: boolean
  electronRunAsNode: boolean
}

export interface ScenarioResult {
  name: string
  durationMs: number
  assertions: number
  entryCount: number
  databaseBytes: number
  walBytes: number
  status: 'passed' | 'failed'
  error?: string
}

export interface SpikeReport {
  runtime: RuntimeSnapshot
  scenarios: ScenarioResult[]
  status: 'passed' | 'failed'
  startedAt: string
  finishedAt: string
}

export interface SpikeRepoContext {
  env: NodeExecutionEnv
  repo: SqliteSessionRepo
}

export function assertPackagedRuntime(snapshot: RuntimeSnapshot): void
export function resolvePackagedExecutable(outputDir: string, platform: NodeJS.Platform): string
export function createSpikeRepo(databasePath: string, cwd: string): SpikeRepoContext
export async function cleanupSession(session: Session): Promise<void>
```

`cleanupSession()` 用 `unknown` 类型守卫检查 `session.getStorage()` 上的 `cleanup`；不存在时抛出 `SQLite SessionStorage 缺少 cleanup()`，不能静默跳过。

`createSpikeRepo()` 必须用 `const env = new NodeExecutionEnv({ cwd })`，再构造
`new SqliteSessionRepo({ env, sqlite: createNodeSqliteFactory(), databasePath })`；每个场景 finally 还要 `await env.cleanup()`。

`scripts/sqlite-spike-main.ts` 必须：

1. 在 `app.whenReady()` 前把 `userData/sessionData/crashDumps/logs` 指向 `--spike-root` 下的目录。
2. 不创建 `BrowserWindow`。
3. 读取 `--report`、`--scenario`、`--child-mode` 参数。
4. 正常父模式先收集 runtime snapshot 并调用 `assertPackagedRuntime()`。
5. 捕获所有错误写入 `SpikeReport`，`app.exit(0|1)`；child crash 模式不走正常退出。

- [ ] **Step 4: 实现临时 staging 和 Packager launcher**

`scripts/sqlite-spike.ts` 导出：

```ts
import { packager } from '@electron/packager'

export interface SpikeLaunchOptions {
  repoRoot: string
  scenario: 'runtime' | 'storage' | 'crash' | 'legacy' | 'full'
  keepTempOnFailure?: boolean
}

export interface SpikeLaunchResult {
  executablePath: string
  reportPath: string
  exitCode: number
  stdout: string
  stderr: string
  report: import('./sqlite-spike-runtime.ts').SpikeReport
}

export async function packageAndRunSpike(options: SpikeLaunchOptions): Promise<SpikeLaunchResult>
```

Packager 配置必须包含这些精确决策：

```ts
const outputPaths = await packager({
  dir: repoRoot,
  name: 'TgBuddySQLiteSpike',
  executableName: 'TgBuddySQLiteSpike',
  out: packageOutput,
  overwrite: true,
  asar: true,
  prune: true,
  electronVersion: electronPackage.version,
  ignore: createSpikeIgnore(repoRoot),
  afterCopy: [
    async (buildPath) => {
      await writeFile(
        join(buildPath, 'package.json'),
        JSON.stringify({
          name: 'tgbuddy-sqlite-spike-fixture',
          version: '0.0.0',
          type: 'module',
          main: 'dist/sqlite-spike/sqlite-spike-main.js',
          dependencies: {
            '@earendil-works/pi-agent-core': '0.82.1',
            '@earendil-works/pi-ai': '0.82.1',
            '@earendil-works/pi-storage-sqlite-node': '0.82.1',
          },
        }),
      )
    },
  ],
})
```

`createSpikeIgnore()` 只允许 root `package.json`、`dist/sqlite-spike/**` 和运行时 `node_modules/**` 进入 staging；因为传入 IgnoreFunction 后 Packager 的默认 ignore 不再代办，函数必须显式排除 `.git`、`node_modules/.bin`、`node_modules/electron`、输出目录和临时目录。不得把 `.ship`、`docs`、`src`、`tests`、用户 `.env` 或真实数据打进 ASAR。

launcher 用 `spawn(executablePath, ['--spike-root', root, '--report', report, '--scenario', scenario])`，显式删除 child env 中的 `ELECTRON_RUN_AS_NODE`。成功时校验 report 存在、JSON 可解析、runtime gate 全真、exit 0；失败时打印并保留 temp。

- [ ] **Step 5: 实现 packaged runtime/bootstrap scenario**

`scripts/sqlite-spike-scenarios.ts` 先只导出：

```ts
export interface ScenarioContext {
  rootDir: string
  executablePath: string
}

export async function runRuntimeScenario(context: ScenarioContext): Promise<ScenarioResult>
export async function runBootstrapScenario(context: ScenarioContext): Promise<ScenarioResult>
```

`runtime` 场景在 packaged 进程内完成 1–2，`bootstrap` 场景完成 3–6；报告必须产生两个独立 `ScenarioResult`：

1. 用 `DatabaseSync(':memory:')` 查询 `sqlite_version()`。
2. 验证 `DatabaseSync` 和 `backup` 导出存在。
3. 对不存在的相对 DB 调 `repo.list()` 得 `[]`。
4. `repo.create({ id: 'bootstrap', cwd })` 后 cleanup。
5. 只读检查 `migrations` 恰有 `001_initial.sql`，七张初始表存在，`journal_mode=wal`、`synchronous=2`、`busy_timeout=5000`、`integrity_check=ok`。
6. 重建 Repo、list/open/cleanup，确认 migration 未重复。

- [ ] **Step 6: 运行纯测试和 packaged runtime**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: 所有 tests PASS。

Run: `bun run spike:sqlite -- --scenario runtime`

Expected: 生成 ASAR packaged 目录，输出 `runtime passed` 和 `bootstrap passed`，report 中 `isPackaged=true`、Electron `39.8.10`、Node `22.22.1`、两个场景 status `passed`，exit 0。

- [ ] **Step 7: 提交**

```powershell
git add scripts/sqlite-spike.ts scripts/sqlite-spike-main.ts scripts/sqlite-spike-runtime.ts scripts/sqlite-spike-scenarios.ts tests/sqlite-spike.test.ts package.json bun.lock
git commit -m "feat: add packaged electron sqlite spike runtime"
```

Expected: 创建一个只包含 Task 2 文件的 commit；`bun run spike:sqlite -- --scenario runtime` 在该 commit 上仍为绿。

---

### Task 3: 验证顺序、隔离、compaction、cleanup 和 WAL backup

**Files:**

- Modify: `scripts/sqlite-spike-scenarios.ts`
- Modify: `scripts/sqlite-spike-main.ts`
- Modify: `tests/sqlite-spike.test.ts`

**Interfaces:**

- Consumes:
  - `ScenarioContext`、`ScenarioResult`、`createSpikeRepo()`、`cleanupSession()`
  - `Session.appendMessage()`、`appendCompaction()`、`getEntries()`、`buildContext()`
  - `DatabaseSync`、`backup` from `node:sqlite`
- Produces:
  - `assertContinuousPrefix(entries: SessionTreeEntry[], expectedPrefix: string, minimum: number, maximum: number): void`
  - `validateCheckpointResult(row: Pick<CheckpointResult, 'busy' | 'log' | 'checkpointed'>): void`
  - `runStorageScenarios(context: ScenarioContext): Promise<ScenarioResult[]>`
  - `checkpointAndBackup(sourcePath: string, backupPath: string): Promise<CheckpointResult>`

**Tier:** standard

- [ ] **Step 1: 写连续前缀和 backup 判据的失败测试**

在 `tests/sqlite-spike.test.ts` 追加：

```ts
import { assertContinuousPrefix, validateCheckpointResult } from '../scripts/sqlite-spike-scenarios.ts'

test('连续前缀拒绝空洞和重复', () => {
  const messages = [
    { type: 'message', id: 'a', parentId: null, timestamp: '2026-01-01T00:00:00.000Z', message: user('crash-0') },
    { type: 'message', id: 'b', parentId: 'a', timestamp: '2026-01-01T00:00:01.000Z', message: user('crash-2') },
  ] satisfies import('@earendil-works/pi-agent-core').SessionTreeEntry[]
  expect(() => assertContinuousPrefix(messages, 'crash-', 1, 10)).toThrow('业务序号不是连续前缀')
})

test('checkpoint 必须无 busy 且完成 checkpoint', () => {
  expect(() => validateCheckpointResult({ busy: 1, log: 10, checkpointed: 4 })).toThrow(
    'WAL checkpoint busy=1',
  )
})

function user(text: string) {
  return { role: 'user' as const, content: [{ type: 'text' as const, text }], timestamp: 1 }
}
```

同时先把 packaged storage scenario 写成明确失败的测试入口，并让
`scripts/sqlite-spike-main.ts` 的 `--scenario storage` 路由到它：

```ts
export async function runStorageScenarios(_context: ScenarioContext): Promise<ScenarioResult[]> {
  throw new Error('storage scenarios not implemented')
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: FAIL，错误包含 `does not provide an export named 'assertContinuousPrefix'`。

Run: `bun run spike:sqlite -- --scenario storage`

Expected: packaged 进程 exit 1，报告错误精确包含 `storage scenarios not implemented`。

- [ ] **Step 3: 实现 1000 entries 和双会话隔离**

`runStorageScenarios()` 的顺序/隔离子场景：

每个子场景使用独立数据库，不能复用上一子场景的删除或 compaction 状态：

1. `ordered-entries`：创建 `ordered-a`，追加 `A-0000` 至 `A-0999`；cleanup/reopen 后恰有 1000 message，业务序号严格连续，ID 无重复。
2. `session-isolation`：同库创建 `isolation-a` 和 `isolation-b`，严格交替追加 A/B 各 100 条；cleanup/reopen 后两者都恰有 100，只含自己的前缀。
3. 两个场景都用 `getEntries()` 核对真实 entry 数、用 `getSessionStats().messageCount` 核对物化计数；只读 SQL 只检查 `session_sequences.next_seq`，不解析 backend 私有 `session_materialized` payload。
4. `delete-cleanup` 使用 isolation DB：cleanup 两者，`repo.delete(A metadata)`；list 只剩 B，`repo.open(A metadata)` 抛 `not_found`，只读检查 A 的 entry 行数为 0，open B 内容不变。

所有 message 使用：

```ts
function indexedUser(prefix: 'A' | 'B' | 'crash', index: number) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: `${prefix}-${index.toString().padStart(4, '0')}` }],
    timestamp: 1_700_000_000_000 + index,
  }
}
```

- [ ] **Step 4: 实现 compaction reopen/buildContext**

使用真实返回 ID：

```ts
const oldId = await session.appendMessage(indexedUser('A', 0))
const keptId = await session.appendMessage(indexedUser('A', 1))
await session.appendCompaction('压缩摘要', keptId, 12_000, { compactedCount: 1 })
await session.appendMessage(indexedUser('A', 2))
```

cleanup/reopen 后断言：

- `getEntries()` 仍含 old、kept、compaction、新 message；
- `buildContext().messages[0]` role 为 `compactionSummary`，summary 为 `压缩摘要`，tokensBefore 为 12000；
- context 不含 A-0000，包含 A-0001/A-0002；
- 再 cleanup 后可立即 rename db，并对当时实际存在的 wal/shm 做同样操作，再 rename 回去，证明无残留锁。

- [ ] **Step 5: 实现 checkpoint + SQLite backup + 独立 restore**

定义：

```ts
export interface CheckpointResult {
  busy: number
  log: number
  checkpointed: number
  backupPages: number
}

export function validateCheckpointResult(
  row: Pick<CheckpointResult, 'busy' | 'log' | 'checkpointed'>,
): void

export async function checkpointAndBackup(
  sourcePath: string,
  backupPath: string,
): Promise<CheckpointResult>
```

`@types/node@22.20.1` 和当前 Electron 嵌套声明都把
`backup(sourceDb, path)` 定义为 `Promise<number>`（
`node_modules/electron/node_modules/@types/node/sqlite.d.ts:679-681`），因此
`backupPages` 直接使用 await 返回值；不得改成 `void` 或伪造页数。

执行顺序不可交换：

1. backup 子场景使用自己的 DB，预先创建两个 Session 并写入至少 1000 条消息和一条 compaction；连接仍打开时断言 `${sourcePath}-wal` 存在且 size > 0，并记录 checkpoint 前 WAL bytes。
2. 所有 Repo Session storage cleanup。
3. `const source = new DatabaseSync(sourcePath)`。
4. `source.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()` 并 `validateCheckpointResult()`，必须 `busy===0`。
5. `const backupPages = await backup(source, backupPath)`，Promise resolve 前 source 保持打开。
6. `source.close()`；把源 db 和当时实际存在的 wal/shm 移到另一个临时目录。
7. 用 backupPath 构造新 Repo，list/open 两个 Session，验证条数、顺序、compaction `buildContext()`、`integrity_check=ok`。
8. restore 成功不能读取被移走的源文件。

- [ ] **Step 6: 运行 storage 场景**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: 所有 pure tests PASS。

Run: `bun run spike:sqlite -- --scenario storage`

Expected: `bootstrap`、`ordered-entries`、`session-isolation`、`compaction`、`delete-cleanup`、`wal-backup-restore` 全部 passed；ordered=1000，isolation A/B 各 100，checkpoint busy=0，exit 0。

- [ ] **Step 7: 提交**

```powershell
git add scripts/sqlite-spike-scenarios.ts scripts/sqlite-spike-main.ts tests/sqlite-spike.test.ts
git commit -m "test: verify sqlite session durability and backup"
```

Expected: 创建一个只包含 Task 3 文件的 commit；storage 的六个场景在该 commit 上全部通过。

---

### Task 4: 验证 packaged child 强杀恢复

**Files:**

- Modify: `scripts/sqlite-spike-main.ts`
- Modify: `scripts/sqlite-spike-scenarios.ts`

**Interfaces:**

- Consumes:
  - Task 2 `ScenarioContext`、`ScenarioResult`、`createSpikeRepo()`、`cleanupSession()`
  - Task 3 `assertContinuousPrefix()`
- Produces:
  - `runCrashChild(options: CrashChildOptions): Promise<never>`
  - `runCrashRecoveryScenario(context: ScenarioContext): Promise<ScenarioResult>`

**Tier:** judgment

- [ ] **Step 1: 写 crash scenario 的失败入口**

在 `scripts/sqlite-spike-scenarios.ts` 先加入明确失败的 packaged test，并让
`scripts/sqlite-spike-main.ts` 的 `--scenario crash` 路由到它：

```ts
export async function runCrashRecoveryScenario(
  _context: ScenarioContext,
): Promise<ScenarioResult> {
  throw new Error('crash recovery scenario not implemented')
}
```

launcher 把 `SpikeLaunchOptions.scenario` 原样传给 packaged 进程。

- [ ] **Step 2: 运行 packaged test 确认失败**

Run: `bun run spike:sqlite -- --scenario crash`

Expected: packaged 进程 exit 1，报告错误精确包含 `crash recovery scenario not implemented`。

- [ ] **Step 3: 实现同 packaged 可执行文件的强杀 child**

`scripts/sqlite-spike-main.ts` 的 `--child-mode crash-writer` 分支调用：

```ts
export interface CrashChildOptions {
  databasePath: string
  cwd: string
  sessionId: string
  markerPath: string
  minimumCommitted: number
  maximumPlanned: number
}

export async function runCrashChild(options: CrashChildOptions): Promise<never>
```

child 行为：

1. open 指定 Session，从 0 开始通过 `Session.appendMessage(indexedUser('crash', i))` 写入。
2. 每次 append resolve 后先写 `${markerPath}.tmp`，再 rename 覆盖 marker，把最新 i 原子发布；到 `minimumCommitted=25` 后继续写至 `maximumPlanned=100000`。
3. 不调用 cleanup/app.exit；若极端情况下写到计划上限，等待一个永不主动 resolve 的 Promise 保持进程存活，父进程负责在 child 仍存活时强杀。

父场景：

1. 先创建 `crash-session` 并 cleanup。
2. `spawn(process.execPath, ['--child-mode','crash-writer',...])`，其中 `process.execPath` 必须等于 packaged exe。
3. 轮询 marker，看到数值 `>=25` 且 child 尚未退出后，在 Windows 用 `spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'])`；其它平台用 `child.kill('SIGKILL')`；必须 await child 的 `exit`/`close` 事件后才 reopen 数据库。
4. 断言 child 非正常退出；reopen 后 entry 数在 25..100000，`assertContinuousPrefix()` 通过，`integrity_check=ok`，物化 count 匹配。
5. 再 append `crash-${count}`、cleanup/reopen，确认序号继续连续。

- [ ] **Step 4: 运行 crash 场景**

Run: `bun run spike:sqlite -- --scenario crash`

Expected: `crash-recovery passed`；child 非正常退出、恢复数量 >=25、业务序号连续、继续追加成功，exit 0。

- [ ] **Step 5: 提交**

```powershell
git add scripts/sqlite-spike-main.ts scripts/sqlite-spike-scenarios.ts
git commit -m "test: verify packaged sqlite crash recovery"
```

Expected: 创建一个只包含 Task 4 文件的 commit；crash 场景在该 commit 上通过。

---

### Task 5: 验证 SQLite legacy 幂等导入

**Files:**

- Modify: `scripts/sqlite-spike-main.ts`
- Modify: `scripts/sqlite-spike-scenarios.ts`
- Modify: `scripts/sqlite-spike-import.ts`
- Modify: `scripts/sqlite-spike.ts`

**Interfaces:**

- Consumes:
  - Task 1 `LegacyParseResult`、`LegacyMapResult`、`LegacyImportDecision`
  - Task 2 `ScenarioContext`、`ScenarioResult`、`packageAndRunSpike()`
- Produces:
  - `importLegacySession(repo: SqliteSessionRepo, parsed: LegacyParseResult): Promise<LegacyImportOutcome>`
  - `runLegacyImportScenario(context: ScenarioContext): Promise<ScenarioResult>`

**Tier:** judgment

- [ ] **Step 1: 写 legacy packaged test 的失败入口**

在 `scripts/sqlite-spike-scenarios.ts` 先加入失败的 packaged test，并让 main 的
`--scenario legacy` 路由到它：

```ts
export async function runLegacyImportScenario(
  _context: ScenarioContext,
): Promise<ScenarioResult> {
  throw new Error('legacy import scenario not implemented')
}
```

- [ ] **Step 2: 运行 packaged test 确认失败**

Run: `bun run spike:sqlite -- --scenario legacy`

Expected: packaged 进程 exit 1，报告错误精确包含 `legacy import scenario not implemented`。

- [ ] **Step 3: 实现 SQLite legacy 幂等导入和 fixture 交付**

`scripts/sqlite-spike-import.ts` 增加：

```ts
import type {
  SqliteSessionMetadata,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node'

export interface LegacyImportOutcome {
  action: 'created' | 'skipped' | 'rebuilt'
  metadata: SqliteSessionMetadata
  importedEntries: number
  diagnostics: LegacyDiagnostic[]
}

export async function importLegacySession(
  repo: SqliteSessionRepo,
  parsed: LegacyParseResult,
): Promise<LegacyImportOutcome>
```

实现顺序：

1. `mapLegacyEntries(parsed)` 得到 expected fingerprint/digest/count。
2. `repo.list()` 按 deterministic Session ID（`legacy-${sha256(parsed.sessionId).slice(0, 32)}`）查找 metadata；fingerprint 只判断同一 legacy Session 的内容是否变化，不能参与 Session ID，否则内容变化时无法检测冲突。
3. metadata marker 固定：

```ts
{
  importer: 'tgbuddy-jsonl-v1',
  legacySessionId: parsed.sessionId,
  fingerprint: parsed.fingerprint,
  entryDigest: mapped.entryDigest,
  entryCount: mapped.entries.length
}
```

4. create：`repo.create({id,cwd,metadata})` 后按顺序 `session.getStorage().appendEntry(entry)`；每次失败 cleanup 并保留半成品供下次 rebuild。
5. skip：open 并重新计算实际 entry id/type digest，一致才返回 skipped。
6. rebuild：只删除 marker/fingerprint 同属 importer 的半成品，再完整 create；不得删除 marker 缺失或 fingerprint 不同的 Session。
7. conflict：抛出包含 session ID 的错误，不覆盖。
8. 每条路径 finally cleanup；成功后 reopen，通过 `getEntries()` 的 id/type digest 验证持久化身份，再通过 `buildContext()` 的 role/content/summary 投影验证 active context。`AgentMessage` 没有 legacy entry ID，禁止从 context 中伪造 ID 比对。

launcher 在启动 packaged exe 前把 `tests/fixtures/legacy-sessions.json` 和
`tests/fixtures/legacy-session.jsonl` 复制到
`${spikeRoot}/legacy-input/sessions.json` 与
`${spikeRoot}/legacy-input/sessions/legacy-a.jsonl`；它只负责准备输入，不做解析或断言。
`tests/**` 仍不进入 ASAR。packaged `legacy-import` 场景只从 `--spike-root` 下的
`legacy-input` 读取，连续导入两次，断言第一次 created、第二次 skipped、第二次新增数
0、Session/entry 数不变、诊断精确包含第 12/13 行。随后把同一 parsed input 的
`sessionId` 改为 `legacy-partial`，用 Repo/Storage API 预建带正确 importer
marker/fingerprint 但只含前两条 entry 的半成品；调用 importer 必须返回 rebuilt 且最终
digest/count 完整。最后再构造一个同 deterministic ID 但无 marker 的 Session，断言
conflict 且原 entries 不变。

- [ ] **Step 4: 运行 legacy 场景**

Run: `bun run spike:sqlite -- --scenario legacy`

Expected: `legacy-import passed`；首次 created、第二次 skipped、半成品 rebuilt、坏行诊断为 12/13、冲突不覆盖，exit 0。

- [ ] **Step 5: 提交**

```powershell
git add scripts/sqlite-spike.ts scripts/sqlite-spike-main.ts scripts/sqlite-spike-scenarios.ts scripts/sqlite-spike-import.ts
git commit -m "test: verify sqlite legacy import"
```

Expected: 创建一个只包含 Task 5 文件的 commit；legacy 场景在该 commit 上通过。

---

### Task 6: 汇总完整报告、证据和回归质量门

**Files:**

- Modify: `scripts/sqlite-spike-main.ts`
- Modify: `scripts/sqlite-spike-runtime.ts`
- Modify: `scripts/sqlite-spike.ts`
- Modify: `tests/sqlite-spike.test.ts`
- Create: `.ship/tasks/sqlite-packaged-electron-spike/evidence/README.md`

**Interfaces:**

- Consumes:
  - Task 2 `SpikeReport`、`ScenarioResult`、`packageAndRunSpike()`
  - Task 3 storage scenario results
  - Task 4 `runCrashRecoveryScenario()`
  - Task 5 `runLegacyImportScenario()`
- Produces:
  - `REQUIRED_SCENARIOS: readonly ['runtime','bootstrap','ordered-entries','session-isolation','crash-recovery','compaction','delete-cleanup','wal-backup-restore','legacy-import']`
  - `assertCompleteSpikeReport(report: SpikeReport): void`
  - `renderEvidence(report: SpikeReport): string`
  - 完整 `.ship/tasks/sqlite-packaged-electron-spike/evidence/README.md`

**Tier:** standard

- [ ] **Step 1: 写 report completeness 的失败测试**

在 `tests/sqlite-spike.test.ts` 追加：

```ts
import { assertCompleteSpikeReport } from '../scripts/sqlite-spike-runtime.ts'

test('完整报告缺少 crash 或 import 场景时失败', () => {
  expect(() =>
    assertCompleteSpikeReport({
      runtime: validRuntime(),
      scenarios: [{ name: 'runtime', durationMs: 1, assertions: 1, entryCount: 0, databaseBytes: 0, walBytes: 0, status: 'passed' }],
      status: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
    }),
  ).toThrow('缺少必需场景: crash-recovery')
})

function validRuntime() {
  return {
    isPackaged: true,
    defaultApp: false,
    appPath: 'C:\\app\\resources\\app.asar',
    electron: '39.8.10',
    node: '22.22.1',
    sqlite: '3.51.2',
    hasDatabaseSync: true,
    hasBackup: true,
    electronRunAsNode: false,
  }
}
```

必需场景顺序固定为：

```ts
export const REQUIRED_SCENARIOS = [
  'runtime',
  'bootstrap',
  'ordered-entries',
  'session-isolation',
  'crash-recovery',
  'compaction',
  'delete-cleanup',
  'wal-backup-restore',
  'legacy-import',
] as const
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: FAIL，错误包含 `does not provide an export named 'assertCompleteSpikeReport'`。

- [ ] **Step 3: 完成 full report gate 和证据文档**

`assertCompleteSpikeReport(report)` 必须：

- packaged main 的 `--scenario full` 严格按 `REQUIRED_SCENARIOS` 顺序调用各场景；单场景命令仍只运行选中的测试及其 runtime/bootstrap 前置。
- runtime gate 全部通过；
- `REQUIRED_SCENARIOS` 每项恰好出现一次且 status passed；
- 所有 scenario 有 duration/assertions/entryCount/databaseBytes/walBytes；
- report status passed；
- error 字段只允许在 failed scenario。

`.ship/tasks/sqlite-packaged-electron-spike/evidence/README.md` 由 launcher 的
`renderEvidence(report: SpikeReport): string` 生成，固定拼接以下内容和实际场景行：

```ts
export function renderEvidence(report: SpikeReport): string {
  const rows = report.scenarios
    .map((item) =>
      `| ${item.name} | ${item.status} | ${item.durationMs} | ${item.entryCount} | ${item.databaseBytes} | ${item.walBytes} |`,
    )
    .join('\n')
  return `# SQLite Packaged Electron Spike Evidence

## Baseline
- Git: 4735c9da87d5a8a65e074175b34562efaff4dd83
- Command: bun run spike:sqlite

## Runtime
- app.isPackaged: ${report.runtime.isPackaged}
- ASAR: ${report.runtime.appPath.endsWith('app.asar')}
- Electron: ${report.runtime.electron}
- Node: ${report.runtime.node}
- SQLite: ${report.runtime.sqlite}
- pi storage: 0.82.1

## Scenarios
| Scenario | Result | Duration | Entries | DB bytes | WAL bytes |
|---|---|---:|---:|---:|---:|
${rows}

## Compatibility warnings
- model_change.channelId 以 legacy.model_change 保存，未伪装为 provider。
- truncate 按现有最早截断点语义恢复 active context。

## Verification
- bun run typecheck
- bun test
- bun run build
- bun run spike:sqlite
`
}
```

launcher 只允许把版本、数字和 passed/failed 行写入 evidence；不得写 API key、用户名、机器绝对路径或临时目录。

- [ ] **Step 4: 运行完整质量门**

Run: `bun test tests/sqlite-spike.test.ts`

Expected: 所有 pure tests PASS。

Run: `bun run spike:sqlite`

Expected: 九个必需场景全部 passed；child 被强杀且恢复连续前缀；legacy 第二次 skipped；exit 0。

Run: `bun run typecheck`

Expected: exit 0。

Run: `bun test`

Expected: 现有测试和新增 pure tests 全部 PASS。

Run: `bun run build`

Expected: main/preload/renderer 全部构建成功。

- [ ] **Step 5: 核对范围和提交**

Run:

```powershell
git diff --name-only 4735c9da87d5a8a65e074175b34562efaff4dd83 -- src/main src/preload src/renderer
```

Expected: 无输出。

Run:

```powershell
git status --short
```

Expected: 本任务只新增/修改 File Map 中的文件；用户原有 README/docs 改动仍保留且未暂存。

提交：

```powershell
git add scripts/sqlite-spike.ts scripts/sqlite-spike-main.ts scripts/sqlite-spike-runtime.ts tests/sqlite-spike.test.ts .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md
git commit -m "feat: complete packaged electron sqlite spike"
```

Expected: 创建一个只包含 Task 6 文件的 commit；四条完整质量门命令仍全部通过。

## Acceptance Coverage

| Spec criterion | Implemented by |
|---|---|
| Packaged Electron、ASAR、runtime 版本、exit 0 | Task 2 |
| 1000 entries 顺序/ID/恢复 | Task 3 |
| 两 Session 隔离 | Task 3 |
| 同 packaged exe 强杀、连续提交前缀、继续写 | Task 4 |
| compaction reopen/buildContext | Task 3 |
| list/delete/cleanup/文件锁 | Task 3 |
| checkpoint + `node:sqlite.backup()` + 独立 restore | Task 3 |
| legacy 全类型、诊断、幂等、partial/conflict | Task 1 + Task 5 |
| duration/count/size/错误诊断和无敏感路径 evidence | Task 2 + Task 6 |
| typecheck/test/build 和生产 SessionStore 不变 | Task 6 |

## Self-review

- Spec coverage：10/10 acceptance criteria 都有对应任务。
- Placeholder scan：所有创建/修改步骤都给出具体路径、接口、关键逻辑、命令和预期结果。
- Type consistency：`RuntimeSnapshot`、`ScenarioResult`、`LegacyParseResult`、`LegacyMapResult`、`LegacyImportOutcome` 的生产/消费关系在 Interfaces 中一致。
- Constraints propagation：版本、packaged gate、生产路径禁改、WAL/crash/importer 禁止捷径都位于 Global Constraints。
- Anti-shortcut：明确禁止 Node-mode 代替 packaged、SQL 伪造业务数据、正常退出冒充 crash、活跃 WAL 文件复制、channelId 伪装 provider、逐条 leaf 改变 truncate 语义和覆盖冲突 Session。
