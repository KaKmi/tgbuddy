# SQLite packaged-Electron 集成 Spike：独立规格

基线：`main@4735c9da87d5a8a65e074175b34562efaff4dd83`。本规格独立完成，未读取宿主 `spec.md` 或既有 `peer-spec.md`。

## Problem / Motivation

项目当前只有 `electron .` 开发启动和三段构建，没有正式打包命令；主进程产物通过 esbuild 保留外部包（`package.json:7-19`）。现有会话存储是 `sessions.json` 索引加每会话 JSONL，消息追加、索引原子替换，尚未接入 SQLite（`src/main/session-store.ts:1-12,31-33`）。因此，仅在 Bun、系统 Node，甚至 `ELECTRON_RUN_AS_NODE=1` 下成功导入 `node:sqlite`，都不能证明应用被打包后仍能找到 SQLite 包、迁移 SQL 和 Electron 内嵌 Node API。

本 Spike 的目标是用一个与产品入口隔离的、无窗口的 packaged Electron 主进程，验证：

- Electron 39 的实际打包运行时支持 `node:sqlite`；
- `@earendil-works/pi-storage-sqlite-node` **固定版本 0.82.1** 的 `SessionRepo` / `SessionStorage` 契约可用；
- 建库迁移、顺序写入、会话隔离、异常终止恢复、压缩上下文恢复、连接清理、WAL 备份恢复和旧 JSONL 导入均可在同一验收入口内复现；
- 全部数据只写 OS 临时目录，不读取或修改 `~/.tgbuddy`，不接触生产 `SessionStore`、IPC、Renderer。

## Design approach

### 1. packaged runtime 是唯一验收运行时

新增独立 Electron Builder 配置，把 Spike 的 ESM 主进程打进 `app.asar`，再由一个薄启动器执行生成的 `.exe`。启动器可以由 Bun 负责构建、打包、传入临时目录和读取结果，但**所有功能断言必须在 packaged Electron 主进程或它派生的同一 packaged `.exe` 子进程内完成**。

packaged 主进程启动即断言：

- `app.isPackaged === true`；
- `process.defaultApp !== true`；
- `process.env.ELECTRON_RUN_AS_NODE` 不存在；
- `process.versions.electron` 主版本为 `39`；
- `process.versions.node >= 22.19.0`；
- `app.getAppPath()` 指向 `app.asar`；
- `node:sqlite` 导出 `DatabaseSync` 和 `backup`，并能在 `:memory:` 中执行 `select sqlite_version()`。

调查预检已用 `node_modules/electron/dist/electron.exe` 得到 Electron `39.8.10`、Node `22.22.1`、SQLite `3.51.2`，且 `DatabaseSync`/`backup` 可见；锁文件也固定解析到 Electron 39.8.10（`bun.lock:649`）。但该预检使用了 `ELECTRON_RUN_AS_NODE`，**不满足 packaged gate**，只能说明内嵌 runtime 有能力。

Spike 在 Electron ready 前把 `userData`、`sessionData`、`crashDumps` 和日志路径重定向到启动器提供的临时根目录；无 `BrowserWindow`，结束时显式清理临时目录。仓库现有产品数据目录硬编码为 `homedir()/.tgbuddy`（`src/main/channel-store.ts:9-20`），Spike 不导入该模块。

### 2. 使用真实 Repo 契约，不用 SQL 伪造业务行为

固定安装 `@earendil-works/pi-storage-sqlite-node@0.82.1`。该包声明 Node `>=22.19.0`，依赖同版本线的 `pi-ai` / `pi-agent-core`，并只导出 ESM（审计 tarball `package/package.json:1-37`）。用已安装 core 的 `NodeExecutionEnv`，以临时场景目录为 `cwd`，把它结构化传给 `SqliteSessionRepo`；其实现正好只要求 `absolutePath/createDir/exists`。`NodeExecutionEnv.absolutePath` 以自身 cwd 解析路径（`node_modules/@earendil-works/pi-agent-core/dist/harness/env/nodejs.js:303-312`）。

Repo 级 CRUD 只能调用 `create/open/list/delete`；会话写入只能调用 `Session.appendMessage`、`appendCompaction` 或导入时的 `SessionStorage.appendEntry`。禁止直接向 `sessions`、`session_entries`、序列表或物化表插入数据。原始 SQL 仅允许用于只读审计、PRAGMA、`integrity_check`、WAL checkpoint 和备份验证。

core 契约要求 Repo 提供 `create/open/list/delete/fork`（`node_modules/@earendil-works/pi-agent-core/dist/harness/types.d.ts:363-369`），Storage 提供 leaf、entry、path、cursor 等方法（同文件 `:337-353`）。`Session.buildContext()` 从当前 branch 读取并应用默认压缩转换（`node_modules/@earendil-works/pi-agent-core/dist/harness/session/session.js:114-123`）；最新 compaction 会替换旧上下文并保留边界后的消息（同文件 `:23-55,63-90`）。

### 3. 场景隔离与统一报告

每个场景使用临时根目录下自己的数据库，避免前一场景污染后一场景。packaged 主进程写一份机器可读 JSON 报告，至少包含 runtime 版本、`isPackaged`、每个场景的断言数、数据库 `integrity_check`、失败堆栈和最终状态；失败立即置非零退出码。启动器只验证 `.exe` 的退出码和报告完整性，不在 Bun 中替代业务断言。

## Investigation findings

### 当前应用链路

- 产品主入口按 `app.isPackaged` 在 Vite URL 与 `dist/renderer/index.html` 间切换（`src/main/index.ts:11-13,39-45`）；这证明当前代码知道开发/打包差异，但仓库没有打包器配置，`package.json:8-19` 只有 build/dev/test。
- IPC 直接绑定同步 `session-store` 的 list/create/delete/messages（`src/main/ipc.ts:39-61`）；orchestrator 初始化 Agent 时重放 JSONL，并在 `message_end` 追加落盘（`src/main/orchestrator.ts:141-151,180-186`）。Spike 不修改或调用这条链。
- JSONL 格式版本为 2，entry 全集为 `message/model_change/compaction/custom/truncate`（`src/shared/types/session.ts:26-61`）。`SessionMessage` 又分 `kernel/notice/compaction`（`src/shared/types/message.ts:65-101`）。
- 当前读取逐行 `JSON.parse`，跳过坏行并只汇总坏行数量（`src/main/session-store.ts:222-247`）；Spike 导入器需提升为文件、会话、1-based 行号和原因的结构化诊断。
- 当前压缩重放取最后一条 compaction，并从 `firstKeptEntryId` 恢复保留消息（`src/main/session-store.ts:162-205`）；生产压缩测试覆盖重复压缩只保留最新摘要及边界（`tests/compaction.test.ts:187-217`）。
- `safe-file` 对 JSON 索引使用 `.tmp/.bak` 三级回退（`src/main/safe-file.ts:23-38,43-75`），而 JSONL 是直接 append；SQLite Spike 不复用 `safe-file`，其恢复目标是 SQLite transaction/WAL。
- 生产沙箱在 `ExecutionEnv` 层代理文件操作（`src/main/tools/sandboxed-env.ts:28-44,47-95`）。Spike 使用未包沙箱的 `NodeExecutionEnv`，但 cwd 只能指向临时根；不得使用生产 `createSandboxedEnv`，以免混淆“产品权限策略”和“存储适配验证”。

### 已审计的 SQLite 0.82.1

- 包入口直接用 `DatabaseSync` 包装异步形状的 statement/database/factory，并重新导出 SQLite Repo（审计 tarball `package/dist/index.js:1-67`）。
- 每次打开数据库都会设置 `journal_mode=WAL`、`synchronous=FULL`、`busy_timeout=5000`，随后执行迁移；异常时关闭连接（`package/dist/sqlite/repo.js:14-18,46-58`）。
- 首次迁移创建 migrations 表，按 order 执行尚未记录的 SQL，并在同一 transaction 写迁移记录（`package/dist/sqlite/migrations.js:15-39`）。迁移 SQL 建立 sessions、entries、sequence、branch 和物化表（`package/dist/sqlite/migrations/001_initial.sql:1-49`）。
- append 在一个 transaction 内写 entry、推进 sequence、更新物化状态和 active leaf；失败回滚内存镜像并抛 storage error（`package/dist/sqlite/storage/index.js:203-258`）。`getEntries()` 明确按 `entry_seq` 排序，cursor 分支也在 reverse 后恢复升序（同文件 `:315-342`）。
- Repo `list` 和 `delete` 均在 finally 关闭自己的临时连接（`package/dist/sqlite/repo.js:90-128`）；长生命周期 Session 的实现另有 `cleanup()` 关闭数据库（`package/dist/sqlite/storage/index.js:343-345`），但该方法未进入 core `SessionStorage` 接口，这是需要本地类型守卫的契约缺口。
- entry 解码会跳过 malformed payload；写入端验证所有 pi entry 变体（`package/dist/sqlite/storage/session-entries.js:14-88,97-170`）。Spike 不能把这种静默跳过误当作导入诊断。
- Node 22 类型声明中 `backup(sourceDb, path)` 是异步在线备份 API，source 必须保持打开（`node_modules/electron/node_modules/@types/node/sqlite.d.ts:656-681`）。

## Required scenarios and acceptance behavior

### A. bootstrap / migration

1. 对不存在的相对 DB 路径调用 `repo.list()`，期望 `[]`。
2. `repo.create()` 后验证目录与 DB 被创建。
3. 只读检查 `migrations` 恰有 `001_initial.sql`，所有初始表和索引存在，PRAGMA 为 WAL/FULL/5000。
4. cleanup、重新构造 Repo、再次 open/list；迁移记录仍为一条，`integrity_check = ok`。

### B. 1000 条有序 entry 与两会话隔离

1. 同库创建 A、B，交错写入；A 至少 1000 条带连续业务序号的 message，B 写入另一前缀的小集合。
2. cleanup 后重新 list/open；A 的 `getEntries()` 恰为 1000 条、业务序号严格 `0..999`、无重复，B 只含 B 数据。
3. 检查 A 的 sequence/物化 messageCount 与真实 entry 数一致。
4. cleanup A 后通过 Repo 删除 A，list 只剩 B，重新打开 B 内容不变。

### C. 异常终止恢复

父进程先创建 crash session，然后用 `process.execPath` 派生**同一个 packaged `.exe`** 子进程。子进程在同一临时 DB 连续通过 `Session.appendMessage()` 写入，在到达最小已提交数量后写临时 ready 标记并继续高次数写入；父进程看到标记后用强制终止结束子进程，要求退出为非正常。

恢复断言不硬编码最终条数，因为强杀时点不可确定；它必须满足：

- 数量在最小已提交数和计划上限之间；
- entry 的业务序号是从 0 开始的无间断前缀，无半条、重复或序列空洞；
- `integrity_check = ok`，物化计数与 entry 数一致；
- reopen 后 `buildContext()` 成功，再 append 一条后顺序和统计继续正确。

禁止以 `app.exit()`、正常关闭、模拟异常抛出代替 OS 强杀；也禁止直接构造损坏 DB 冒充 crash recovery。

### D. compaction recovery / buildContext

通过 Session API 追加旧消息、保留消息、compaction 和新消息，记录真实 entry id；cleanup 后 Repo reopen。断言：

- `getEntries()` 仍含原消息和 compaction；
- `getBranch()` 在正确压缩边界停止；
- `buildContext()` 首项是恢复的 `compactionSummary`，summary/tokensBefore 不变；
- 只包含边界后的 retained 消息及 compaction 后新消息，旧消息不回到模型上下文。

至少覆盖一次 `firstKeptEntryId` 路径；`retainedTail` 可作为第二子例。不得只查询 SQL payload 字符串来宣称 buildContext 成功。

### E. list / delete / cleanup 锁

反复 create/open/list/cleanup/delete；对 Session storage 用显式类型守卫确认 runtime `cleanup()` 存在并 await。全部关闭后，在 Windows 上立即将 DB、`-wal`、`-shm` 重命名或删除再恢复，证明没有残留句柄；失败时报告具体仍被锁的路径。禁止用固定长 sleep 掩盖未关闭连接，只允许短重试处理杀毒软件瞬时占用。

### F. WAL checkpoint、backup、restore

1. 保持一个 Repo session 的连接处于打开但空闲状态并写入足量数据，确认 WAL 模式和 sidecar 出现。
2. 用独立 `DatabaseSync` 连接执行 `PRAGMA wal_checkpoint(TRUNCATE)`，断言返回 `busy=0`；再调用 `backup(sourceDb, backupPath)`，backup 完成前 source 不关闭。
3. cleanup 所有 source 连接；把 backup 当作独立恢复 DB，构造新 Repo，list/open 两个会话并验证条数、顺序、compaction/buildContext 和 `integrity_check`。
4. 恢复验证不得依赖原 DB 的 `-wal/-shm`；临时移走原 DB 后仍须通过。

禁止用普通 `copyFile` 在活跃 WAL 数据库上代替 SQLite backup API。

### G. legacy JSONL 全类型、诊断与幂等导入

导入 fixture 必须在临时目录生成真实 `sessions.json` 与 `sessions/{id}.jsonl`，包含合法 header、所有当前合法 entry 变体、至少一条 JSON 语法坏行和一条语义坏行。逐行先解析、验证、形成结构化诊断，再写 Repo。

建议映射（全部保留 legacy `id`，时间戳转 ISO，并用上一有效 leaf 形成 parent 链）：

| legacy | SQLite/pi entry |
|---|---|
| `message` + `kind=kernel` | `message`，内部 pi message 原样保留 |
| `message` + `kind=notice` | `custom_message`，`customType=tgbuddy.notice`，保留 `notice/text/display` |
| `message` + `kind=compaction` | `compaction`，保留 summary、boundary、tokens 和 compactedCount details |
| `model_change` | `model_change`，暂以 `channelId -> provider`、`modelId -> modelId` |
| `compaction` | `compaction` |
| `custom` | `custom`，`key -> customType`、`value -> data` |
| `truncate` | `leaf` 导航，target 为 `fromId` 的前驱 entry；缺失目标则诊断并跳过 |

header 不写 entry，但校验 `type/version/kernel/cwd`；支持可解释的 v1/v2，拒绝未来版本。每条诊断至少包含 sessionId、相对文件、1-based 行号、类别和原因。未知 kind/type、重复 id、非法 parent/boundary 均诊断，不允许静默吞掉。

幂等键为 `legacy session id + SHA-256(index meta + 原始 JSONL)`；Repo create metadata 写入 importer schema、fingerprint 和预期 entry 摘要。第二次导入相同源时 reopen 校验 entry id/type 摘要：

- 完整一致：skip，零新增；
- 同 fingerprint 但部分写入：delete 该带本 importer marker 的半成品，再完整重建；
- 同 id 但 marker 缺失或 fingerprint 不同：报 conflict，绝不覆盖。

验收连续执行导入两次，第二次 imported=0/skipped=1，数据库 entry/session 数不变，首次坏行诊断精确。导入后必须 reopen 并用 `getEntries()`/`buildContext()` 验证，不得只检查 marker。

`truncate -> leaf` 与 `channelId -> provider` 是本 Spike 的明确建议，但它们与产品业务语义仍有风险：现有 JSONL 的 truncate 重放是从最早截断点统一裁剪（`src/main/session-store.ts:194-201`），而 channelId 是产品渠道实例，不一定等于 pi provider。Spike 报告必须把两项标为 compatibility warning；不得借本任务修改生产格式。

## Scope / non-goals / forbidden shortcuts

范围内只有独立 Spike、固定依赖、打包配置、临时 fixture/importer 和运行器。

明确不做：

- 不修改 `src/main/session-store.ts`、`src/main/ipc.ts`、`src/main/orchestrator.ts`、`src/preload/**`、`src/renderer/**` 或共享 IPC；
- 不迁移真实 `~/.tgbuddy`，不改变产品默认存储；
- 不设计产品切换开关、回滚 UI、性能基准或发布安装包；
- 不把 JSONL importer 直接接入启动流程。

禁止捷径：

- Bun/system Node 通过而 packaged Electron 未通过；
- `electron .` 或 `ELECTRON_RUN_AS_NODE` 充当 packaged gate；
- 测试内手写业务表数据，绕开 Repo/Session；
- 正常退出冒充 crash；
- 活跃 WAL 库直接复制冒充 backup；
- 只计行数、不校验顺序、隔离、物化状态与 buildContext；
- importer 静默跳坏行或第二次重复追加；
- 为了过测试读取/修改真实用户目录。

## Changes by file

已验证存在、需要修改：

- `package.json`：增加精确 `@earendil-works/pi-storage-sqlite-node@0.82.1` 生产依赖；将 Electron 固定在 39.x 的已解析版本；增加 Electron Builder、匹配 Electron Node 22 的 `@types/node`，以及 build/package/run Spike scripts。
- `bun.lock`：由 Bun 更新并锁定上述版本。
- `tsconfig.json`：当前只 include `src/**/*` 与 `scripts/**/*`（`tsconfig.json:19`），增加 `spikes/**/*`，使常规 typecheck 覆盖 Spike。

已用 `Test-Path` 验证不存在、需要新建：

- `spikes/sqlite-packaged-electron/main.ts`：无窗口 packaged 入口、父/强杀子角色、场景执行与 JSON 报告。
- `spikes/sqlite-packaged-electron/scenarios.ts`：bootstrap、1000 entries、隔离、crash 恢复、compaction、锁和 WAL backup/restore 场景。
- `spikes/sqlite-packaged-electron/legacy-import.ts`：全类型解析、映射、诊断、fingerprint 和幂等恢复。
- `spikes/sqlite-packaged-electron/electron-builder.yml`：`app.asar`、独立 productName/appId、`extraMetadata.main`、`dist/sqlite-spike-packaged` 输出和 `--dir` Windows 产物。
- `scripts/run-sqlite-packaged-electron-spike.ts`：构建/打包、创建 OS temp 根、清除 `ELECTRON_RUN_AS_NODE`、启动 packaged `.exe`、读取报告和清理。

构建必须保持 storage 包为 external production dependency，确保 `package/dist/sqlite/migrations/001_initial.sql` 被打入产物；其迁移加载器使用相对 `import.meta.url` 读取该文件（`package/dist/sqlite/migrations.js:1-13`）。若把包完全 bundle 成单 JS 而漏掉 SQL，bootstrap 应在 packaged gate 中失败，而不是回退到测试内建表。

## Acceptance criteria

一次 `bun run spike:sqlite-packaged` 必须：

1. 构建并生成 packaged Windows `.exe`，由该 `.exe` 自证 packaged/runtime 条件；
2. 在临时根内完成 A–G 全部场景，报告全绿、退出 0；
3. 1000 条顺序、双会话隔离、删除后幸存会话、强杀恢复前缀和继续写均正确；
4. compaction 在 reopen 后由真实 `buildContext()` 恢复；
5. list/delete/cleanup 后无 DB/WAL/SHM 锁；
6. checkpoint 无 busy，Node `backup()` 产物在没有原 WAL sidecar 时独立恢复；
7. legacy 全类型导入有精确坏行诊断，第二次零新增，冲突不覆盖；
8. `integrity_check` 全部为 `ok`；
9. 运行前后没有创建或修改 `~/.tgbuddy`，没有加载产品 SessionStore/IPC/Renderer。

此外 `bun run typecheck`、现有 `bun test`、`bun run build` 必须继续通过；Spike 不是替代现有回归测试。

## Test plan

执行顺序：

1. `bun install` 后运行 typecheck、现有 Bun tests 和生产 build，建立无回归基线。
2. build Spike ESM，Electron Builder `--dir --win` 打包。
3. 启动 packaged `.exe --spike-root <temp> --report <temp/report.json>`。
4. packaged 父进程依次运行 runtime/bootstrap、顺序与隔离、compaction、锁、WAL backup/restore、legacy importer；crash 场景派生同 exe 子进程。
5. 每场景 finally cleanup Session storage、NodeExecutionEnv、直接 DatabaseSync；失败也写报告。
6. 启动器读取报告，打印精简摘要，删除临时目录；失败时保留临时目录路径供诊断。
7. 最后再跑现有 typecheck/tests/build，确认没有生产路径耦合。

## Risks / unknowns

- `node:sqlite` 在当前 Electron 预检仍发出 ExperimentalWarning；虽然版本/API 已预检，**app.asar 内迁移资源、Electron Builder 依赖裁剪和 packaged child 自启动尚未实跑**，必须由本 Spike 自身裁决。
- `cleanup()` 存在于 SQLite storage 实现但不在 core `SessionStorage` interface；升级包时可能消失，类型守卫必须 fail-fast。
- Windows 强杀落点非确定，所以验证“连续已提交前缀 + 一致物化状态”，不能要求固定条数；若子进程过快写完，应增加计划上限，而不是改成正常退出。
- WAL sidecar 是否在很小数据量下仍存在取决于 checkpoint 时机；测试需写足量页并在 session 连接保持打开时观察，不能把 sidecar 未出现当作 backup 已验证。
- `truncate -> leaf` 和 `channelId -> provider` 尚无生产迁移决策；本 Spike 只能发 warning 和验证建议映射，不能暗中确立产品兼容承诺。
- Electron Builder 可能把根项目大量生产依赖带入目录产物；本任务优先验证正确性与资源完整性，不以包体积为验收项。

## Self-review

- 占位符扫描：无未完成段落或空白验收项。
- 矛盾扫描：预检与验收已严格分开；Bun 只编排，断言只在 packaged Electron。
- 覆盖扫描：runtime、契约、迁移、1000 顺序、隔离、crash、compaction/buildContext、list/delete/cleanup、WAL backup/restore、全类型 import/诊断/幂等均有对应场景。
- 歧义扫描：明确了 crash 的非固定数量判据、全类型映射、幂等冲突策略、临时目录边界和 packaged gate。
- 完整性扫描：已禁止 Node-mode、原始 SQL 造数据、正常退出、普通文件复制、静默坏行和真实用户数据等可“只让测试过”的替代实现。
