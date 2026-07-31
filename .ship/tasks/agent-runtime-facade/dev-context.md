# Dev Context

## Test Command

```powershell
bun test
```

按 Slice 追加：

```powershell
bun run check:architecture
bun run typecheck
bun run build
```

## Code Conduct

- 注释、测试、诊断和文档使用中文，保留必要的英文类型名和 API 名。
- 永远不用 `any`；对象类型优先 `interface`；仅类型导入使用 `import type`。
- Runtime 只依赖 shared/runtime，不得 import Electron、React、Node、SQLite、pi、Main 或 Infrastructure。
- Main IPC 只调用 Runtime 公共门面；Preload/Renderer wire API 不改变。
- 不保留旧 Runtime alias/wrapper，不扩大 compatibility 豁免。
- 使用 Conventional Commits；只暂存当前 Slice 文件，不使用 `git add .` 或 `git add -A`。
- 不覆盖或提交任务外未跟踪文件。

## Pattern References

### Story R01：AgentRuntime 正式门面

- Reference: `src/runtime/app/tgbuddy-runtime.ts`
  - Why analogous: 当前唯一门面 owner，本 Slice 原地迁移而非重建。
  - Mirror: command/query 分组、闭包保留 receiver、统一事件 publisher、幂等 dispose。
  - Deviations: 只改变文件、类型、factory、dependency 和事件命名。
- Reference: `src/runtime/app/runtime-events.ts`
  - Why analogous: 当前门面唯一事件发布器。
  - Mirror: Set listener、同步 emit、unsubscribe closure、clear。
  - Deviations: 仅增加 AgentRuntime 语义前缀。
- Reference: `tests/unit/runtime/tgbuddy-runtime.test.ts`
  - Why analogous: 已锁定门面 receiver、清理顺序、事件和 active-run guard。
  - Mirror: Bun test fixture 与精确 calls/events 断言。
  - Deviations: 文件、suite 和导入名称改变，行为断言不变。

### Story R02：Run start 语义链

- Reference: `src/runtime/runs/run-coordinator.ts`
  - Why analogous: 当前唯一 Run 调度 owner。
  - Mirror: registry single-flight、in-flight tracking、AgentEngine event loop、settlement、abort 和 dispose。
  - Deviations: `send()` 改为 `start()`，输入类型改为 `StartRunInput`，方法体不变。
- Reference: `src/shared/contracts/ipc.ts`
  - Why analogous: `agent:send` wire contract 与 Preload API 的唯一类型源。
  - Mirror: `IpcCommandMap` 与 `TgBuddyAPI` 推导方式。
  - Deviations: request DTO 移到 `contracts/run.ts`，channel/API 名不变。
- Reference: `tests/agent-concurrency.test.ts`
  - Why analogous: 最完整覆盖 Coordinator single-flight、跨 Session 并行、stop、dispose。
  - Mirror: deferred fake engine、明确事件顺序与状态断言。
  - Deviations: 只迁移输入类型和方法名。

## Waves

```text
Wave 1: R01
  生产：AgentRuntime 门面、事件、Runtime barrel、Main Composition/IPC
  测试：门面 + architecture

Wave 2: R02
  依赖 R01 的 AgentRuntime 接口
  生产：StartRunInput、RunCommands、RunCoordinator、Main translation
  测试：门面 + Coordinator/integration/concurrency
```

两个 Story 共享 `agent-runtime.ts`、`main/ipc.ts`、`create-legacy-runtime.ts`，因此严格顺序执行。
