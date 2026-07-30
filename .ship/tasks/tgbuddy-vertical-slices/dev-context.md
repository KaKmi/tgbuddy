# Dev Context

## Test Command

```bash
bun test
```

固定附加门槛：

```bash
bun run check:architecture
bun run typecheck
```

SQLite、kernel、bundle 和 UI Slice 再按计划追加 `spike:sqlite`、`probe`、`build` 或真实 Electron 验证。

## Code Conduct

- 注释、测试、诊断和文档使用中文，保留必要英文 API/类型名。
- 永远不用 `any`；对象类型优先 `interface`；仅类型导入使用 `import type`。
- Runtime 不依赖 Electron、Node 文件系统、SQLite、pi 或具体 infrastructure。
- pi 运行时调用只在 `src/kernel/pi/**`。
- Composition Root 显式装配；不引入 DI 容器和模块级 service locator。
- compatibility 只能委托，不能承接新业务。
- Renderer 优先复用 AI Elements 和现有 Markdown/streamdown/Conversation/Response 链路；AI Elements 没有对应能力时才创建组件。
- UI 结构、状态、交互和值以本地原型为准，不使用 AI Elements 默认效果自行发明产品设计。
- 一个 Slice 一个 commit；只暂存当前 Slice 文件。

## Pattern References

### K01: AppDatabase 迁移协议与 packaged 证明

- Reference: `scripts/sqlite-spike-runtime.ts`
  - Why analogous: 定义 packaged runtime、场景结果、必需场景顺序和报告校验。
  - Mirror: 明确 interface、稳定场景名、严格完整性断言、Bun 与 Electron Node 能力分离。
  - Deviations: K01 场景直接 import 生产 `AppDatabase`，不经 pi backend。
- Reference: `scripts/sqlite-spike-scenarios.ts`
  - Why analogous: 在 packaged Electron 内执行真实 SQLite 场景并收集文件指标。
  - Mirror: `assertCondition`、`try/finally` 关闭连接、独立临时数据库、可审计指标。
  - Deviations: 只验证 `app_schema_migrations`、reopen 和 close 后无锁，不创建业务表。
- Reference: `tests/sqlite-spike.test.ts`
  - Why analogous: 纯 Bun 层验证完整报告、顺序和 evidence，不假装执行 Electron SQLite。
  - Mirror: `bun:test`、固定 runtime fixture、完整场景表。
  - Deviations: 真正 AppDatabase 断言在 packaged 场景内完成。

### K02: SQLite SessionCatalogRepository

- Reference: `src/main/session-store.ts`
  - Why analogous: 现有 SessionMeta create/list/update/delete 语义和侧栏排序基线。
  - Mirror: ID/时间戳由调用方提供或显式生成，列表按 `updatedAt` 倒序，删除不触碰其它 Session。
  - Deviations: 新 repository 不读写 JSON/JSONL，不持有模块级 cache。
- Reference: `src/infrastructure/sqlite/app-database.ts`
  - Why analogous: K02 必须复用 K01 的同一 app connection 和 migration protocol。
  - Mirror: `app_*` namespace、显式 close、Electron Node 能力边界。
  - Deviations: `002_app_sessions.sql` 创建首个业务表，repository 只通过 AppDatabase connection callback 访问。
- Reference: `scripts/sqlite-spike-scenarios.ts`
  - Why analogous: SQLite 功能只能在 packaged Electron Node 22 中做真实 reopen/隔离验证。
  - Mirror: 独立临时 DB、try/finally close、稳定 ScenarioResult 和完整报告顺序。
  - Deviations: K02 通过 `SessionRepository` port 验证产品 catalog，不使用 pi SessionRepo。

### K03: 会话侧栏切换到 SQLite

- Reference: `src/runtime/app/tgbuddy-runtime.ts`
  - Why analogous: Renderer/IPC 已依赖稳定的 `SessionCommands`，无需感知 catalog 实现。
  - Mirror: create/list/update/delete/messages/compactedMessages 契约保持不变。
  - Deviations: `createSessionCommands()` 把 SQLite catalog 与暂留的 JSONL history 组合成同一纵向能力。
- Reference: `src/main/bootstrap/create-application.ts`
  - Why analogous: 唯一 Composition Root 负责打开/关闭进程级资源并注入 Runtime。
  - Mirror: 显式 database path、失败回滚、幂等 dispose。
  - Deviations: K03 首次把 `AppDatabase` 接入生产；退出顺序为停止 IPC/Runtime、解除 compatibility bridge、关闭数据库。
- Reference: `src/main/session-store.ts`
  - Why analogous: legacy orchestrator/compaction 仍从这里读取和更新 SessionMeta。
  - Mirror: get/update 的既有 no-op 与强制 id/updatedAt 语义。
  - Deviations: K03–K08 临时 bridge 转发到同一 SQLite repository；catalog 的 create/list/delete 不再由 production Runtime 委托给 JSON 索引。

### K04: pi Session backend 适配器

- Reference: `scripts/sqlite-spike-runtime.ts`
  - Why analogous: 已验证 `SqliteSessionRepo`、`NodeExecutionEnv` 与 storage cleanup 的正确组合。
  - Mirror: backend 自己创建连接和 migration；每个 Session storage 显式 cleanup；环境在 store dispose 时释放。
  - Deviations: 生产 adapter 通过 Runtime `MessageStore` port 暴露原生 entry，不暴露 repo metadata 或私有表。
- Reference: `scripts/sqlite-spike-scenarios.ts`
  - Why analogous: 已有 ordered entries、session isolation、compaction、delete 与 reopen 的 packaged 证明。
  - Mirror: 精确 entry ID/parentId/顺序、两个 Session、close/reopen、删除后不可打开。
  - Deviations: 新 `pi-session-store` 场景直接覆盖生产 `PiSessionStore`，并先在同一物理 DB 执行 app migration。
- Reference: `src/shared/contracts/message.ts`
  - Why analogous: 当前架构已决定 pi 消息类型只做 type alias，不做第二套归一化。
  - Mirror: type-only import、版本护栏、零字段复制。
  - Deviations: K04 新增 `PersistedSessionEntry` alias，供 Runtime port 保持 pi entry 无损。

### K05: 消息历史切换到 pi Session backend

- Reference: `scripts/sqlite-spike-import.ts`
  - Why analogous: Spike 已验证现有 `SessionMessage` 到 pi 原生 message/custom_message/compaction entry 的无翻译映射。
  - Mirror: 信封 ID 写入 entry ID、线性 parentId、notice details、compaction details 和 `pi@0.82` 版本护栏。
  - Deviations: 生产 `SessionMessageHistory` 只处理当前可写类型；legacy truncate/custom 的一次性迁移留给 K06。
- Reference: `src/runtime/sessions/session-commands.ts`
  - Why analogous: catalog 与消息历史必须作为同一个用户动作创建和删除，不能留下只存在一侧的半会话。
  - Mirror: Composition Root 注入、创建失败回滚 catalog、删除先释放消息 backend 再删 catalog。
  - Deviations: Session create/delete/messages 改为 Promise；Preload/Renderer 原本已使用 Promise，因此 IPC 名称和 UI 调用方式不变。删除以用户可见 catalog 为 commit point：catalog 失败不触碰消息，history 清理失败只留下不可见孤儿并显式上报。
- Reference: `src/renderer/App.tsx`
  - Why analogous: 当前时间线已经通过 `window.tgbuddy.session.messages()` 读取 `SessionMessage[]`，并使用现有 AI Elements Conversation/Response 与 Markdown 链路。
  - Mirror: 保持消息 contract 和组件树，不引入新视觉或第二套渲染。
  - Deviations: K05 无需修改 Renderer；异步 SQLite 边界由原有 preload Promise 吸收。

### K06: legacy JSONL 一次性导入

- Reference: `scripts/sqlite-spike-import.ts`
  - Why analogous: Spike 已验证逐行诊断、fingerprint、entry digest、active context 和 create/skip/rebuild/conflict 决策。
  - Mirror: 将纯解析/映射逻辑原样迁入 infrastructure；真实 pi Session 写入单独收进 `kernel/pi`。
  - Deviations: 生产导入使用原 Session ID，确保 SQLite catalog 与 pi history 共用一个 ID；Spike 的 hash ID 只保留给冲突隔离场景。
- Reference: `src/main/bootstrap/create-application.ts`
  - Why analogous: Composition Root 是同时持有 app catalog 与 pi backend 工厂的唯一装配点。
  - Mirror: 在 Runtime 接受流量前完成一次导入；每个 Session 独立失败，诊断只记录、不阻塞应用启动。
  - Deviations: history 先提交、catalog 后提交；catalog 是用户可见 commit point，进程中断后下次启动会 skip 已完成 history 并补 catalog。
- Reference: `scripts/sqlite-spike-scenarios.ts`
  - Why analogous: 只有 packaged Electron Node 22 能真实加载 `node:sqlite` 与 pi SQLite backend。
  - Mirror: 覆盖首次启动、二次启动、迁移后新增 tail、坏行、catalog/history 冲突 ID、半成品重建、truncate 后无原边界 compaction 和 `pi@0.82` 护栏。
  - Deviations: Bun 测试只负责文件加载隔离与纯决策，不伪装执行 backend。
- Review correction:
  - 幂等判断逐字段校验 importer 拥有的完整 payload 前缀；只允许完全一致的短前缀 rebuild，前缀后的新消息属于正常产品数据，任何后续启动都不得 rebuild。
  - truncate 删除 compaction 原边界时写入独立 synthetic boundary 和 leaf；production `SessionMessageHistory` 通过 marker 只回放摘要及迁移后的新 tail。
  - catalog 已有同 ID 时用不可漂移的 `id + createdAt` 验证身份；不能证明同源则诊断冲突，不创建 history。

## Waves

M1 的 K01–K17 存在严格数据/装配依赖，并共享 Composition Root、Runtime contract 或 compatibility owner，因此全部顺序执行：

```text
K01 -> K02 -> K03 -> K04 -> K05 -> K06
  -> K07 -> K08 -> K09 -> K10 -> K11 -> K12
  -> K13 -> K14 -> K15 -> K16 -> K17
  -> M1 E2E -> M1 QA -> 全量回归
```
