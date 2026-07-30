# Dev Context

## Test Command

`bun run check:architecture && bun run typecheck && bun test && bun run build`

Story 1A 的 TDD 聚焦命令：`bun test tests/unit/architecture/import-boundaries.test.ts`

## Code Conduct

- 注释、测试、诊断和文档使用中文，保留必要英文术语。
- 永远不用 `any`；对象类型优先 `interface`；仅类型导入使用 `import type`。
- Runtime 不得 import Electron、React、Node 文件系统、SQLite、pi 或具体 infrastructure。
- pi 运行时调用只允许在 `src/kernel/pi/**`；公共消息契约只保留计划允许的 pi type-only 例外。
- 不使用通用 DI 容器；Composition Root 使用显式构造。
- 保留任务外工作树改动；提交时只暂存 Story 1A 文件。
- 使用 Conventional Commits。

## Pattern References

### Story 1A：固化仓库边界、公共契约与 Runtime 门面

- Reference: `src/shared/ipc.ts`
  - Why analogous: 当前 IPC 常量、DTO 和 Preload API 的唯一集中定义。
  - Mirror: 保留现有通道名和友好 API，不改变 Renderer 行为。
  - Deviations: 类型来源迁入 `src/shared/contracts/ipc.ts`，旧路径只做兼容 re-export，并注明 Story 6 删除。
- Reference: `src/main/ipc.ts`
  - Why analogous: 当前所有宿主命令与事件桥接的真实调用面。
  - Mirror: 保留 IPC 注册和窗口销毁保护。
  - Deviations: handler 只调用 `TgBuddyRuntime`，旧 service/store 查找迁入 Story 1C 删除的 Main compatibility adapter。
- Reference: `tests/agent-concurrency.test.ts`
  - Why analogous: 使用 `bun:test`、中文用例名、直接断言纯 TypeScript 行为。
  - Mirror: 测试无需 Electron 进程，fixture 由测试自行创建和清理。
  - Deviations: 架构测试使用临时项目树覆盖 import 解析和依赖矩阵。

## Waves

- Wave 1（sequential）：Story 1A。用户只指定本 Story；它不消费更早 Story 的接口。
- Story 1B/1C 依赖本 Story 产生的 Runtime 公共门面与 compatibility 删除期限，本轮不实施。
