# SQLite Packaged Electron Spike 设计规格

> 续接基线：`main@4735c9da87d5a8a65e074175b34562efaff4dd83`。本文件早于基线记录创建；本轮保留原有章节并按当前代码、独立 peer 调查和运行时实测补齐。

## Problem / Motivation

当前会话存储由 src/main/session-store.ts 的 sessions.json + 线性 JSONL 组成。架构已决定 SQLite 作为 canonical storage，但必须先验证 Electron 打包运行时、pi SQLite Session backend、崩溃恢复和 WAL 备份的组合。

本 spike 是隔离验证程序，不修改生产 SessionStore，不接 IPC/Renderer，不迁移用户数据。它只决定后续是否采用 SQLite，以及生产迁移需要保留哪些约束。

## Design Approach

新增独立 launcher 和无窗口 packaged Electron runner。launcher 只负责构建、用 `@electron/packager@20.0.4` 生成启用 ASAR 的临时应用目录、启动产物和读取报告；所有 SQLite/Repo/Session 断言都在 packaged Electron 主进程或它派生的同一个 packaged 可执行文件内执行。runner 启动即断言 `app.isPackaged === true`、`process.defaultApp !== true`、未设置 `ELECTRON_RUN_AS_NODE`、`app.getAppPath()` 位于 `app.asar`，再验证 Electron/Node/SQLite 版本和 `node:sqlite`。

SQLite backend 固定为 `@earendil-works/pi-storage-sqlite-node@0.82.1` 的 devDependency，不进入生产入口或生产 dependencies。打包器在临时 staging 副本中生成最小 package metadata，使 backend、pi core 和 pi-ai 作为 fixture 的运行时依赖进入 ASAR；迁移 SQL 必须由包内 `import.meta.url` 正常读取，不能在测试里重建 schema 兜底。

每个场景使用独立临时目录，结束时通过类型守卫显式调用 Session storage `cleanup()`。强杀场景派生同一个 packaged 可执行文件；父进程在收到至少一个提交标记后强制终止 child，重新打开数据库并验证连续、无洞、无重复的已提交前缀。WAL 备份在所有 Session 连接 cleanup 后用独立 `DatabaseSync` 执行 `wal_checkpoint(TRUNCATE)`，要求 `busy=0`，再调用 `node:sqlite.backup()` 生成独立恢复库；禁止对活跃 WAL 数据库只复制主 db 文件。

旧 JSONL 导入先逐行解析和语义校验，再把当前 `SessionEntry` 全集映射为 pi tree entries。导入保留 legacy id、时间戳和可恢复数据，必须幂等，坏行报告相对文件、1-based 行号、类别和原因。`model_change.channelId` 不是 pi `provider`，不得伪装成 provider；以 `legacy.model_change` custom entry 无损保存并报告兼容警告。`truncate` 必须同时保留审计数据，并把最终 active leaf 移到当前 `replaySessionEntries()` 语义计算出的最早截断点之前；不能用逐条 `truncate -> leaf` 后继续追加来悄悄改变现有重放语义。

## Investigation Findings

- package.json:8-19 只有 dev、build、probe、test、typecheck，没有 SQLite spike 命令。
- package.json:21-23、47-52 使用 pi 0.82.1、Electron 39；bun.lock:649 锁定 Electron 39.8.10。
- Electron binary 实测为 v39.8.10；ELECTRON_RUN_AS_NODE=1 下实测 Node 22.22.1、SQLite 3.51.2。
- docs/01-架构设计.md:412-452 和 docs/02-功能范围.md:140-160 明确要求 packaged integration gate；`ELECTRON_RUN_AS_NODE` 只能作为能力预检，不能作为最终验收。
- package.json:7-19 没有打包器或发布配置，因此本 Spike 只能使用独立临时 fixture，不能顺带确立产品发布工具链。
- src/main/index.ts:5-10、61-64 是生产 Electron 入口；spike 不应挂入该入口。
- src/main/session-store.ts:1-13、31-50、77-110、121-159、360-419 是现有 JSONL 创建、读取、删除、压缩和追加路径。
- src/main/session-store.ts:222-247 已有坏 JSON 行逐行跳过逻辑，导入器必须保留可诊断的坏行计数。
- src/main/safe-file.ts:23-38、43-77、80-89 只保护 JSON 原子写，不能替代 SQLite WAL 备份验证。
- pi SQLite backend 的 repo.d.ts:3-24 提供 create/open/list/delete/fork；types.d.ts:15-45 提供 database、factory、metadata 和 env contract。
- pi SQLite backend 的 repo.js:14-23 启用 WAL、synchronous FULL、busy_timeout 5000，并检查 cleanup；repo.js:46-57 执行目录创建和 migration；repo.js:110-127 在事务内删除 Session 数据。
- pi SQLite storage index.d.ts:15-36 提供 create/open、appendEntry、getEntries、cleanup；index.js:203-257 在事务内写 entry、sequence、materialized state 和 branch index。
- pi SQLite migration 001_initial.sql 创建 migrations、sessions、session_entries、session_sequences、branch_entries、session_materialized、entry_materialized 私有表。
- pi core harness session.d.ts:16-47 提供 appendMessage、appendCompaction、appendCustomEntry、getEntries 和 buildContext；types.d.ts:337-368 定义 SessionStorage/SessionRepo contract。
- src/shared/types/session.ts:44-58 的 legacy entry 是 message/model_change/compaction/custom/truncate；src/shared/types/message.ts:65-101 的 message 又分 kernel/notice/compaction，导入器不能只覆盖 fixture 中碰巧出现的子集。
- src/main/session-store.ts:162-205 对所有 truncate 取最早裁剪点；pi leaf 是树导航，两者语义不同，必须通过兼容测试显式裁决。
- Electron 目标运行时实测 `node:sqlite.backup` 存在；Node 22 的 backup API 能从保持打开的 `DatabaseSync` 生成一致性备份，适合验证 WAL 恢复而不是普通文件复制。

## Scope

### In scope

1. 通过启用 ASAR 的 packaged Electron 目录产物验证运行时版本和 node:sqlite。
2. 新库 migration/bootstrap 和 schema 检查。
3. 1000 entries 创建、追加、关闭、恢复和顺序检查。
4. 两个 Session 交替追加，验证行隔离。
5. child 突然退出后重新打开，验证提交前缀和无半条 entry。
6. compaction entry 关闭后恢复，验证 buildContext 的摘要和保留边界。
7. delete、list、cleanup 和文件锁检查。
8. WAL checkpoint backup，在新目录恢复并重新打开。
9. legacy JSONL fixture 导入、坏行报告、重复导入幂等。
10. 输出每个场景时长、entry 数、数据库大小、WAL 大小和失败诊断。
11. 从启用 ASAR 的 packaged 应用执行所有断言，并验证迁移 SQL 确实可从包内加载。

### Out of scope

- 不修改 src/main/session-store.ts、src/main/ipc.ts、Renderer 或生产数据目录。
- 不在 spike 中创建 TgBuddy app_* 表。
- spike 通过前不把 sqlite backend 加入生产 dependencies，也不为产品选择 Electron Builder/Forge 等发布工具链。
- 不实现 Workspace、BlobStore、MCP、Skill 或 child delegation。
- 不调用 Provider，不需要 API key。
- 不把 Bun 或系统 Node 的成功当作 Electron 成功。

## Proposed files

- Create: scripts/sqlite-spike.ts，Node launcher：构建、临时 staging、`@electron/packager`、运行产物和读取报告。
- Create: scripts/sqlite-spike-main.ts，无窗口 packaged Electron 入口、父/强杀子角色和场景编排。
- Create: scripts/sqlite-spike-runtime.ts，runtime gate、Repo factory、cleanup guard、报告类型和通用断言。
- Create: scripts/sqlite-spike-scenarios.ts，bootstrap、顺序/隔离、compaction、cleanup/delete、crash 和 backup/restore 场景。
- Create: scripts/sqlite-spike-import.ts，legacy 解析、全类型映射、诊断、fingerprint 和幂等恢复。
- Create: tests/sqlite-spike.test.ts，纯 fixture/import 和断言测试。
- Create: tests/fixtures/legacy-sessions.json，legacy 索引元数据。
- Create: tests/fixtures/legacy-session.jsonl，包含合法 header、全部 entry/message 变体、一行 JSON 语法错误和一行语义错误。
- Modify: package.json:8-19、38-52，增加 `spike:sqlite` 命令和精确 devDependencies：`@electron/packager@20.0.4`、`@earendil-works/pi-storage-sqlite-node@0.82.1`、`@types/node@22.20.1`；Node 类型升级用于覆盖 Electron Node 22 的 `node:sqlite`/`backup` 声明。
- Modify: bun.lock，锁定上述 devDependencies；不改变现有 pi/Electron 的生产依赖范围。
- Create: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md，记录命令、版本和通过证据。

## Acceptance Criteria

1. 生成并启动启用 ASAR 的 packaged Electron 目录产物；产物内 `app.isPackaged === true`、`app.getAppPath()` 指向 `app.asar`、未设置 `ELECTRON_RUN_AS_NODE`，并打印 Electron 39.8.10、Node 22.22.1 和 SQLite 版本；全部场景通过时退出码为 0。
2. 新数据库创建并恢复 1000 entries，顺序不变、无重复 ID、无丢失。
3. 两个 Session 各追加 100 entries，重新打开后各自正好 100 条，不串行。
4. 同一 packaged 可执行文件的 child 被 OS 强制终止后数据库可打开；业务序号是从 0 开始、位于已确认最小值和计划上限之间的连续前缀，无重复/空洞，`integrity_check=ok`，reopen 后可继续追加。
5. compaction entry 恢复后 buildContext 包含摘要和正确保留消息。
6. delete 后 repo.list 不再返回 Session，相关 entry 不可查询，cleanup 后没有锁错误。
7. 所有 Session 连接 cleanup 后 checkpoint 返回 `busy=0`；`node:sqlite.backup()` 产物在移走源 db/wal/shm 后仍可从新目录打开，Session、entries、compaction context 与源数据库一致。
8. legacy JSONL 全部现有 entry/message 变体都有映射或明确兼容警告；重复导入只产生一个逻辑 Session，entry ID/type/count 稳定，坏行有相对文件和 1-based 行号诊断，半成品只在 importer marker/fingerprint 匹配时重建，冲突绝不覆盖。
9. 输出含每场景 duration、entry count 和错误诊断，不把 API key、用户数据或机器绝对路径提交到仓库。
10. bun run typecheck 和 bun test 继续通过，生产 session-store 行为不变。

## Test plan

- 纯导入和 fixture 测试使用 bun test tests/sqlite-spike.test.ts。
- Electron integration 使用 bun run spike:sqlite，必须生成并调用 packaged 目录产物；启动器不得承载业务断言。
- crash 场景由 packaged 父进程派生同一个可执行文件，等待提交标记、强杀、检查非正常退出并重新打开。
- backup 场景在所有 Session cleanup 后用 `wal_checkpoint(TRUNCATE)` + `node:sqlite.backup()`，移走源 db/wal/shm 后从新目录打开。
- 所有临时目录位于操作系统 temp，finally 清理；失败时报告写到仓库外。

## Risks / Unknowns

- sqlite backend 尚未安装为生产依赖，spike 必须固定加载审计版本，不能静默解析其它版本。
- backend 使用 pi tree entries，而产品最终仍是线性领域模型；本 spike 只验证耐久性和 backend contract。
- `truncate` 与 pi leaf、`channelId` 与 pi provider 不是同义概念；本 Spike 保留数据并发出 compatibility warning，不暗中作生产迁移决策。
- DatabaseSync 底层同步，适配器表面异步；交替写入必须实际验证锁和一致性。
- Windows packaged Electron、ASAR 资源裁剪和 child 自启动尚未实跑；runner 必须捕获 stdout/stderr，失败时保留 temp/evidence 路径。
