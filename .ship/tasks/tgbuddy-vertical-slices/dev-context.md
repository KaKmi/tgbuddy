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

## Waves

M1 的 K01–K17 存在严格数据/装配依赖，并共享 Composition Root、Runtime contract 或 compatibility owner，因此全部顺序执行：

```text
K01 -> K02 -> K03 -> K04 -> K05 -> K06
  -> K07 -> K08 -> K09 -> K10 -> K11 -> K12
  -> K13 -> K14 -> K15 -> K16 -> K17
  -> M1 E2E -> M1 QA -> 全量回归
```
