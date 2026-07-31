# TgBuddy 目标代码仓库迁移计划

> **For agentic workers:** Use `/ship:dev target-code-repository-architecture` to implement this plan story-by-story. Steps use checkbox syntax for tracking.

**Goal:** 在不改变已批准产品语义的前提下，把现有 Electron 原型迁移为职责清晰、依赖单向、覆盖第一版全部功能的模块化仓库。

**Architecture:** 业务规则进入 `src/runtime` 的垂直领域模块；pi 调用收口到 `src/kernel/pi`；SQLite、Blob、文件系统、Secret 和 MCP transport 作为 `src/infrastructure` adapter；Electron Main 只装配 Runtime 并转发 typed IPC；Renderer 按 feature 管状态和 UI。

**Tech Stack:** TypeScript 5、Bun、Electron 39、React 18、Jotai、pi 0.82.1、`@earendil-works/pi-storage-sqlite-node@0.82.1`、Node SQLite、Tailwind。

## Global Constraints

- 基线为 `main@fc8a3d11a6f8257d9b6dfe700a9cf0e8d181b964`；保留所有任务外工作树改动。
- 注释、测试、诊断和文档使用中文，保留必要英文术语。
- 不以文件数为限制；只在功能迁入时创建文件，不生成空目录或空接口。
- 不重新讨论 `docs/06-设计决策.md` 中已定事项。
- Runtime 不得 import Electron、React、Node 文件系统、SQLite、pi 或具体 infrastructure。
- pi 运行时调用只允许在 `src/kernel/pi/**`；pi message type 允许出现在 shared contract。
- 不使用通用 DI 容器；Composition Root 使用显式构造。
- 不允许 SQLite + JSONL 长期双写；切换后 SQLite 是唯一 canonical。
- app 表不得对 pi 私有表建立 FK、Trigger 或内部字段依赖。
- 每个 Run 使用独立 Mount snapshot、ExecutionEnv、budget 和 cancellation scope。
- 永远不用 `any`；对象类型优先 interface；仅类型导入使用 `import type`。
- 每个 Story 先写失败测试，再写最小实现，再删除旧 owner；review 通过后才能进入下一 Story。
- UI 样式和交互数值以 `tgbuddy-mockup/TgBuddy 交互原型.dc.html` 为唯一事实来源。

## Target Dependency Rules

```text
shared <- runtime
shared + runtime ports <- kernel/pi
shared + runtime ports <- infrastructure
shared + runtime public API + kernel/infrastructure factories <- main
shared <- preload
shared <- renderer
```

任何反向依赖都必须被 `scripts/check-architecture.ts` 阻止。

---

## Milestone 与实施 Story 的对应关系

README 中的 Phase 是产品交付顺序，本计划的 Story 是 Phase 内可以独立开发和 review 的实施单元。两者关系固定如下：

| 产品阶段 | 状态 / 对应实施 Story |
|---|---|
| Phase 0 · SQLite packaged spike | 已完成；只作为后续存储接入的回归门槛，不重复开发 |
| Phase 1 · Session Runtime | Story 1A 仓库边界与 Runtime 门面 → Story 1B SQLite SessionRepo → Story 1C AgentHarness/Run 生命周期 |
| Phase 2 · Workspace 与安全 | Story 2 |
| Phase 3 · Blob 与产物 | Story 3 |
| Phase 4 · 能力系统 | Story 4 |
| Phase 5 · 单层委派 | Story 5 |
| Phase 6 · UI 与恢复验收 | Story 6 |

仓库边界不是额外产品阶段，也不是占位工作。它是 Session Runtime 的第一块实现：先建立真实门面、契约和自动依赖检查，随后立即迁移 SessionRepo 和 AgentHarness。

---

## Story 1A（Phase 1）: 固化仓库边界、公共契约与 Runtime 门面

**Outcome:** 在不改变现有行为的情况下，建立可执行的目录规则和单一宿主门面，后续迁移不再继续向 `main` 堆逻辑。

**Files:**

- Create: `docs/07-代码仓库设计.md`
- Create: `scripts/check-architecture.ts`
- Create: `tests/unit/architecture/import-boundaries.test.ts`
- Create: `src/shared/contracts/ids.ts`
- Create: `src/shared/contracts/workspace.ts`
- Create: `src/shared/contracts/session.ts`
- Create: `src/shared/contracts/run.ts`
- Create: `src/shared/contracts/message.ts`
- Create: `src/shared/contracts/events.ts`
- Create: `src/shared/contracts/permission.ts`
- Create: `src/shared/contracts/capability.ts`
- Create: `src/shared/contracts/artifact.ts`
- Create: `src/shared/contracts/channel.ts`
- Create: `src/shared/contracts/context.ts`
- Create: `src/shared/contracts/ipc.ts`
- Create: `src/shared/errors.ts`
- Create: `src/runtime/app/tgbuddy-runtime.ts`
- Create: `src/runtime/app/runtime-events.ts`
- Create: `src/runtime/index.ts`
- Create: `src/main/bootstrap/create-application.ts`
- Create: `src/main/bootstrap/create-legacy-runtime.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `docs/DOCS_INDEX.md`

**Interfaces:**

- `TgBuddyRuntime`
- `RuntimeEvent` / `RuntimeEventListener`
- `RuntimeDependencies`
- `IpcCommandMap` / `TgBuddyAPI`

### Architecture checker acceptance matrix

扫描范围：

- Include: `src/**/*.{ts,tsx}`
- Exclude: `src/**/*.d.ts`、`dist/**`、`node_modules/**`
- 必须解析：相对 import、目录 `index.ts`、`.ts/.tsx` 后缀、`tsconfig.json` paths、Vite alias。

`import type` 默认与 value import 一样计入依赖；唯一例外是：

- `src/shared/contracts/message.ts` 可以 type-only import `@earendil-works/pi-ai` / `@earendil-works/pi-agent-core`。
- `src/shared/contracts/events.ts` 可以 type-only import pi 的 `StopReason` / `Usage`；不得 value import。

完整规则：

| Source | Allowed targets | Forbidden examples |
|---|---|---|
| `src/shared/**` | shared；上述两个文件的 pi type-only exception | runtime、kernel、infrastructure、main、preload、renderer、Electron/React/Node runtime |
| `src/runtime/**` | shared、runtime | `@earendil-works/pi-*`、electron、react、node:*、kernel、infrastructure、main、preload、renderer |
| `src/kernel/pi/**` | shared、runtime 中的 port contract、pi package、必要 node:* | infrastructure、main、preload、renderer、Electron |
| `src/infrastructure/**` | shared、runtime 中的 port contract、必要 node:*/electron adapter API | kernel、main、preload、renderer、Runtime concrete service |
| `src/main/bootstrap/**` | shared、`src/runtime/index.ts`、kernel factory、infrastructure factory、main 内部、Electron/Node | renderer、preload |
| `src/main/ipc/**` | shared、`src/runtime/index.ts`、main 的纯 IPC helper、Electron | `runtime/**` 内部路径、kernel、infrastructure、repository/store |
| `src/main/index.ts` / lifecycle / window | shared、`src/runtime/index.ts`、main 内部、Electron/Node | renderer、preload、concrete repository |
| `src/preload/**` | shared、Electron context bridge | runtime、kernel、infrastructure、main、renderer |
| `src/renderer/**` | shared、renderer、前端 package；通过 `window.tgbuddy` 调 Preload | runtime、kernel、infrastructure、main、preload、electron、node:* |

checker 失败输出每条 `source -> target -> violated rule`，无违规退出 0，有违规退出 1。

### Steps

- [ ] 写 checker 的内存 fixture/临时 fixture 测试，逐行覆盖上表：每一行至少一个合法 import 和一个非法 import；额外覆盖 type-only pi exception、alias、目录 index 和多条违规聚合输出。
- [ ] 运行 `bun test tests/unit/architecture/import-boundaries.test.ts`，确认因 checker 不存在而失败。
- [ ] 实现 import 解析和完整矩阵；扫描 `src/**/*.{ts,tsx}`，排除 `.d.ts`；支持相对路径、`.ts/.tsx`、目录 index、tsconfig paths 和 Vite alias；输出 source、target、rule，违规退出 1。
- [ ] 增加 `bun run check:architecture`，让 CI/build gate 可直接调用。
- [ ] 把现有 shared 类型按 workspace/session/run/message/event/permission/capability/artifact/channel/context/ipc 迁到 contracts；先用兼容 re-export 保持调用方编译。
- [ ] 定义 `TgBuddyRuntime` 门面和事件订阅契约；`create-legacy-runtime.ts` 在 Main 边界委托现有 orchestrator/store，Runtime 本身不得反向 import Main。
- [ ] 建立显式 `createApplication()`，Main 入口不再自行查找业务模块。
- [ ] 用 `satisfies TgBuddyAPI` 校验 preload 友好 API；IPC command map 成为请求/响应唯一类型来源。
- [ ] 对齐 `tsconfig.json` 与 `vite.config.ts` 的 alias；同一个 alias 不得在 TypeScript 指向 `src`、在 Vite 指向 `src/renderer`。
- [ ] 写 `docs/07-代码仓库设计.md`，内容与本规格一致，并在 DOCS_INDEX 加索引。
- [ ] 运行 `bun run check:architecture && bun run typecheck && bun test && bun run build`。
- [ ] Reviewer 阻断检查：compatibility 层必须列出删除 Story，不能成为第二个长期门面。

---

## Story 1B（Phase 1）: 接入 SQLite canonical storage 与可恢复 Session Repository

**Outcome:** Workspace/Session catalog/Run/规则/Plan/配置/Artifact 索引进入 app SQLite；pi Session 使用其私有 backend；JSONL 降级为 transfer/recovery。

**Files:**

- Create: `src/runtime/sessions/session-repository.ts`
- Create: `src/runtime/sessions/session-service.ts`
- Create: `src/runtime/sessions/session-transfer.ts`
- Create: `src/infrastructure/sqlite/app-database.ts`
- Create: `src/infrastructure/sqlite/migrations/*.sql`
- Create: `src/infrastructure/sqlite/repositories/*.ts`
- Create: `src/infrastructure/sqlite/jsonl-importer.ts`
- Create: `src/infrastructure/sqlite/jsonl-exporter.ts`
- Create: `src/infrastructure/sqlite/backup-service.ts`
- Create: `src/kernel/pi/pi-session-backend.ts`
- Create: `tests/integration/sqlite/*.test.ts`
- Modify: `src/main/bootstrap/create-application.ts`
- Modify: `package.json`
- Modify during cutover: `src/main/session-store.ts`，只保留带明确删除期限的 compatibility adapter
- Retain as test/spike evidence: `scripts/sqlite-spike-*.ts`

**Interfaces:**

- `SessionRepository`
- `SessionTransfer`
- `AppDatabase`
- `PiSessionBackend`
- `RecoveryService`

### Steps

- [ ] 写 migration/schema 测试：所有 `app_*` 表存在，且没有指向 pi 私有表的 FK/Trigger。
- [ ] 写 repository contract 测试：create/list/update/append terminal metadata/truncate/origin/delete/transaction/reopen。
- [ ] 写 legacy fixture 测试：重复导入幂等、坏行诊断、model_change/truncate 兼容语义保持。
- [ ] 写 crash recovery 测试：只恢复完整 `message_end`，running Run 变 interrupted。
- [ ] 运行新测试，确认失败。
- [ ] 将 SQLite backend 从 spike-only devDependency 调整为生产需要的精确依赖；保持版本与 pi 0.82.1 对齐。
- [ ] 实现 app migration 和 repositories；所有 app 多表写通过一个明确 transaction callback。
- [ ] 在 `kernel/pi` 包装 pi SQLite SessionRepo；只暴露 Runtime 需要的 session contract。
- [ ] 从 spike importer 提炼经过测试的纯解析/映射逻辑；不复制 launcher、packager 和场景编排。
- [ ] 实现启动迁移：先备份，再幂等导入 legacy，成功后记录 marker；失败保留原 JSONL 并进入可诊断状态。
- [ ] 切换 SessionService 到 SQLite；停止生产 JSONL append，保留显式 export。
- [ ] 将 `session-store.ts` 收缩为委托 SQLite SessionService 的 compatibility adapter；不得继续写 sessions.json/JSONL，并标记在 Story 1C 删除。
- [ ] 运行 repository contract、全测试、build 和 `bun run spike:sqlite`。

---

## Story 1C（Phase 1）: 用 AgentHarness 重建 Run、Context 与 settled 生命周期

**Outcome:** 裸 `Agent` 编排被 Runtime RunCoordinator + `PiAgentEngine` 取代；发送、停止、压缩、错误和恢复只有一个 owner。

**Files:**

- Create: `src/runtime/runs/agent-engine.ts`
- Create: `src/runtime/runs/run-coordinator.ts`
- Create: `src/runtime/runs/run-registry.ts`
- Create: `src/runtime/runs/run-budget.ts`
- Create: `src/runtime/runs/cancellation-scope.ts`
- Create: `src/runtime/context/context-service.ts`
- Create: `src/runtime/context/compaction-policy.ts`
- Create: `src/kernel/pi/pi-agent-engine.ts`
- Create: `src/kernel/pi/pi-model-catalog.ts`
- Create: `src/kernel/pi/pi-message-adapter.ts`
- Create: `src/kernel/pi/pi-event-adapter.ts`
- Create: `src/kernel/pi/pi-compaction-adapter.ts`
- Create: `tests/unit/runtime/runs/*.test.ts`
- Create: `tests/integration/kernel/pi-agent-engine.test.ts`
- Modify: `src/main/bootstrap/create-application.ts`
- Delete after cutover: `src/main/orchestrator.ts`
- Delete after cutover: `src/main/compaction-service.ts`
- Delete after cutover: `src/main/session-store.ts` compatibility adapter
- Move/replace: `src/kernel/*.ts`

**Interfaces:**

- `AgentEngine.run(invocation): AsyncIterable<AgentEvent>`
- `RunCoordinator.send/stop/stopSession`
- `RunRegistry`
- `RunBudget`
- `CancellationScope`
- `ContextService`

### Steps

- [ ] 审计 installed pi 0.82.1 的 AgentHarness、Session、save point、settled、compaction 和 tool hook 声明，记录在 Story dev-context；不凭旧 API 猜测。
- [ ] 写 RunCoordinator 单测：同 Session 拒绝重入、不同 Session 可并行、旧 run frame 丢弃、stop 幂等、settled 清理。
- [ ] 写 kernel contract 测试：pi error event 不静默、stopReason 正确、message_end 才落 durable message。
- [ ] 写压缩测试：85%、3 秒 defer、beforeModelCall、queued、取消、重启恢复。
- [ ] 运行测试，确认失败。
- [ ] 实现实例级 RunRegistry/CancellationScope，移除模块级 activeRuns/runningAgents/stopped。
- [ ] 实现 `PiAgentEngine`，由 AgentHarness 管 Session context、save point、tool lifecycle 和 settled。
- [ ] 迁移 message/event/context/compaction adapter，保留当前消息信封和双通道语义。
- [ ] RunCoordinator 持久化 root Run 状态；存储失败进入 degraded 并阻止继续产生副作用。
- [ ] 切换 Runtime 门面的 runs API，删除裸 Agent orchestrator 和旧 compaction service。
- [ ] 运行 `bun run probe`、相关 unit/integration、全测试、typecheck、build、architecture check。

---

## Story 2（Phase 2）: 建立逻辑 Workspace、PolicyEngine 与 per-run ExecutionEnv

**Outcome:** Workspace 可重定位；并发 Run 不串路径；所有文件工具经过 canonical path 边界；规则绑定正确 scope。

**Files:**

- Create: `src/runtime/workspaces/workspace-service.ts`
- Create: `src/runtime/workspaces/workspace-repository.ts`
- Create: `src/runtime/workspaces/mount-resolver.ts`
- Create: `src/runtime/permissions/policy-engine.ts`
- Create: `src/runtime/permissions/permission-service.ts`
- Create: `src/runtime/permissions/permission-repository.ts`
- Create: `src/runtime/permissions/permission-broker.ts`
- Create: `src/runtime/plans/*.ts`
- Create: `src/runtime/questions/ask-user-service.ts`
- Create: `src/infrastructure/filesystem/canonical-path.ts`
- Create: `src/infrastructure/filesystem/sandboxed-execution-env.ts`
- Create: `tests/unit/runtime/permissions/*.test.ts`
- Create: `tests/integration/filesystem/canonical-path.test.ts`
- Modify: `src/runtime/runs/run-coordinator.ts`
- Delete after cutover: `src/main/permission-service.ts`
- Delete after cutover: `src/main/plan-service.ts`
- Delete after cutover: `src/main/ask-user-service.ts`
- Delete after cutover: `src/main/tools/sandbox.ts`
- Delete after cutover: `src/main/tools/sandboxed-env.ts`

### Steps

- [ ] 写 Workspace relocate 测试：改 Mount 后 Session/Rule/Plan/Artifact 仍按 workspaceId 归属。
- [ ] 写并发隔离测试：A/B Run 的 ExecutionEnv root 不互相覆盖。
- [ ] 写 canonical path 测试：`..`、绝对越界、symlink、junction/reparse、敏感目录、待创建文件父目录。
- [ ] 写 PolicyEngine 表格测试：plan/auto/bypass、builtin/MCP/control/delegation、read/write/destructive、session/workspace/global。
- [ ] 特别写失败测试证明 `mcp__` 前缀不能整体放行，neverPersist 不可持久化。
- [ ] 实现 WorkspaceRepository/MountResolver；删除自动创建未知 workspace 目录的逻辑。
- [ ] 实现纯 PolicyEngine 和独立 PermissionBroker；Rule 使用明确 `sessionId?` / `workspaceId?`，不再用 ownerId 猜语义。
- [ ] ExecutionEnvFactory 按 Run 创建实例并持有不可变 Mount snapshot；文件 Tool 不再直接用 Node fs。
- [ ] Session 删除先 `stopSession()` 并等待 settled，再 clear broker 和删除。
- [ ] 删除旧全局 sandbox/permission/plan/ask-user owners。
- [ ] 在 Windows 真实临时目录运行 integration 测试，再运行全套 gate。

---

## Story 3（Phase 3）: 引入 BlobStore、Artifact 索引与附件/长输出投影

**Outcome:** 大对象不再进入消息；工作区文件与非工作区产物有明确归属；结果区可恢复。

**Files:**

- Create: `src/runtime/artifacts/artifact-service.ts`
- Create: `src/runtime/artifacts/artifact-repository.ts`
- Create: `src/runtime/artifacts/blob-store.ts`
- Create: `src/runtime/artifacts/tool-result-projector.ts`
- Create: `src/infrastructure/filesystem/file-blob-store.ts`
- Create: `tests/unit/runtime/artifacts/*.test.ts`
- Create: `tests/integration/filesystem/blob-store.test.ts`
- Modify: `src/shared/contracts/message.ts`
- Modify: `src/shared/contracts/artifact.ts`
- Modify: Tool runtime result path
- Modify: Session delete/recovery flow

### Steps

- [ ] 写阈值测试：附件原图、长 tool output、非 Workspace 文件进入 Blob；消息只含 preview + BlobRef。
- [ ] 写产物识别测试：从 Tool args 推导 write/delete 等产物，不依赖 `details`。
- [ ] 写引用计数/清理测试：Session 删除只删除无引用 Blob，不删除 Workspace 文件。
- [ ] 写崩溃测试：临时 Blob 原子 rename，孤儿 staging 可回收，索引缺文件标 degraded。
- [ ] 实现 content-addressed 或稳定 ID BlobStore、metadata、preview 和受控读取。
- [ ] ToolResultProjector 在落消息前投影并裁剪大输出。
- [ ] Artifact 记录 producer lineage（root/Skill/child）、workspaceId、sessionId、toolCallId。
- [ ] 接入 Runtime/IPC 查询；Renderer 此 Story 只需兼容数据，完整结果区在 Story 6。
- [ ] 运行无 Base64/大输出扫描测试、integration、全套 gate。

---

## Story 4（Phase 4）: 完成 Channel、Profile、Tool、Skill 与 MCP 能力系统

**Outcome:** 每次 Invocation 获得稳定能力快照；MCP/Skill 可管理、可诊断、受权限和上下文预算约束。

**Files:**

- Create: `src/runtime/channels/*.ts`
- Create: `src/runtime/capabilities/capability-assembler.ts`
- Create: `src/runtime/capabilities/profiles/*.ts`
- Create: `src/runtime/capabilities/tools/*.ts`
- Create: `src/runtime/capabilities/tools/builtin/*.ts`
- Create: `src/runtime/capabilities/skills/*.ts`
- Create: `src/runtime/capabilities/mcp/*.ts`
- Create: `src/kernel/pi/pi-skill-loader.ts`
- Create: `src/kernel/pi/pi-tool-adapter.ts`
- Create: `src/infrastructure/mcp/stdio-mcp-transport.ts`
- Create: `src/infrastructure/secrets/electron-secret-store.ts`
- Create: `tests/unit/runtime/capabilities/*.test.ts`
- Create: `tests/integration/mcp/*.test.ts`
- Modify: `src/runtime/runs/run-coordinator.ts`
- Delete after cutover: `src/main/channel-store.ts`
- Delete after cutover: `src/main/tools/index.ts`
- Delete after cutover: `src/main/tools/plan-mode.ts`
- Delete after cutover: `src/main/tools/ask-user.ts`

### Steps

- [ ] 写 Channel Secret 测试：repo 不含明文 key，Renderer DTO 脱敏，模型调用能解析 key。
- [ ] 写 CapabilityAssembler 快照测试：Profile + Workspace + Mode + MCP status 决定 Tool/Skill；运行中变更只影响下一 Invocation。
- [ ] 写 Skill 测试：默认 system prompt 只有摘要，显式调用才加载正文，路径越界拒绝，Windows separator 正常。
- [ ] 写 MCP fake server integration：discover/call/disconnect/reconnect/timeout/long output；断线后下一轮工具消失。
- [ ] 写 context usage 测试，skills/mcp 分类反映真实 schema/摘要 token。
- [ ] 实现 ChannelService + Electron SecretStore；迁移明文 channels.json。
- [ ] 实现 ToolRegistry，控制工具、计划工具和 ask_user 使用同一 tool descriptor/preflight。
- [ ] 实现 SkillRegistry + pi loader adapter。
- [ ] 实现 MCP Manager + stdio transport；权限使用 server/method/risk descriptor，长输出投影 Blob。
- [ ] 删除旧 channel/tool owners；运行 fake MCP、probe、全套 gate。

---

## Story 5（Phase 5）: 实现单层 child delegation 与统一 lineage/budget/cancel

**Outcome:** root 可同步委派最多两个 child，过程可见且不会递归、超预算或取消泄漏。

**Files:**

- Create: `src/runtime/delegation/delegation-service.ts`
- Create: `src/runtime/delegation/delegation-policy.ts`
- Modify: `src/runtime/runs/run-budget.ts`
- Modify: `src/runtime/runs/cancellation-scope.ts`
- Modify: `src/runtime/capabilities/capability-assembler.ts`
- Modify: `src/shared/contracts/run.ts`
- Modify: `src/shared/contracts/events.ts`
- Create: `tests/unit/runtime/delegation/*.test.ts`
- Create: `tests/integration/kernel/delegation.test.ts`

### Steps

- [ ] 写预算测试：前两个 child 可启动，第三个拒绝，失败 child 仍计数，depth > 1 拒绝。
- [ ] 写能力测试：root 有 `delegate_to_agent`，child 永远没有。
- [ ] 写取消测试：root cancel 级联两个 child、permission、plan、ask_user 和 delegate promise。
- [ ] 写 lineage 测试：agent/host event、Artifact、Permission、token metric 都带 rootRunId/agentRunId/parentToolCallId。
- [ ] 写 provider stream 死锁回归：parent 等待 delegate tool 时 child 可正常完成。
- [ ] 实现 DelegationPolicy/Service，child 使用独立 pi Session 但共享 root budget/cancellation。
- [ ] child 结果通过 toolResult 回 parent；完整过程通过 RuntimeEvent 发布和持久化。
- [ ] 运行 targeted concurrency/integration、全套 gate。

---

## Story 6（Phase 6）: 收口 Electron IPC、拆分 Renderer feature 并完成恢复验收

**Outcome:** Electron 成为薄宿主；Renderer 与 Runtime 通过完整 typed contract 工作；三栏 UI 覆盖全部第一版功能。

**Files:**

- Create: `src/main/ipc/*.ts`
- Modify: `src/main/lifecycle.ts`
- Modify: `src/preload/index.ts`
- Create/Move: `src/renderer/app/*.tsx`
- Create/Move: `src/renderer/features/workspaces/*`
- Create/Move: `src/renderer/features/sessions/*`
- Create/Move: `src/renderer/features/conversation/*`
- Create/Move: `src/renderer/features/run-control/*`
- Create/Move: `src/renderer/features/permissions/*`
- Create/Move: `src/renderer/features/plans/*`
- Create/Move: `src/renderer/features/questions/*`
- Create/Move: `src/renderer/features/artifacts/*`
- Create/Move: `src/renderer/features/capabilities/*`
- Create/Move: `src/renderer/features/settings/*`
- Create/Move: `src/renderer/shared/*`
- Create: `tests/integration/ipc/*.test.ts`
- Create: `tests/e2e/*.test.ts`
- Delete after cutover: `src/main/ipc.ts`
- Delete after cutover: `src/renderer/atoms/agent.ts`
- Delete after cutover: `src/renderer/hooks/useGlobalAgentListeners.ts`
- Reduce: `src/renderer/App.tsx`

### Steps

- [ ] 写 IPC contract 测试：每个 command 有 handler 和 preload method；错误映射稳定；handler 不能 import repository。
- [ ] 写 event router 测试：统一 lineage、旧 run 丢弃、pending snapshot 竞态、切 Session 不丢流。
- [ ] 按 feature 拆 state/reducer/action；global bridge 只路由，不解释所有业务状态。
- [ ] App 只保留三栏组合；会话栏、对话时间线、输入区、结果区、设置各有 owner。
- [ ] 保留工具卡 120ms 状态规则、权限组合粒度、Plan/ask_user、85% 压缩交互和线性 Session UI。
- [ ] 完成 Workspace picker/rebind、Artifact preview、MCP/Skill/Profile 设置、脱敏 Channel 设置。
- [ ] Main IPC 全部改为调用 `TgBuddyRuntime`；删除旧大 router 和 compatibility façade。
- [ ] 应用关闭时 abort/settled/dispose，启动时运行 recovery 并把诊断推 UI。
- [ ] 按 `docs/02-功能范围.md` 跑 7 个 E2E 验收场景并保存证据。
- [ ] 运行最终门槛：
  - `bun run check:architecture`
  - `bun run typecheck`
  - `bun test`
  - `bun run build`
  - `bun run probe`
  - `bun run spike:sqlite`
- [ ] 全仓扫描确认无旧 owner、无 Runtime 禁止依赖、无生产 JSONL append、无 Renderer 明文 key/任意绝对路径。

## Completion Definition

本计划完成不是“目录都建好了”，而是：

1. 每个第一版功能有且只有一个业务 owner。
2. 每条外部依赖通过窄端口进入 Runtime。
3. 旧 `orchestrator/session-store/permission-service/global sandbox/App+总 atom` owner 已删除。
4. 自动架构检查和功能测试共同阻止边界回退。
5. 功能范围的七个验收场景在 packaged Electron 中有可复核证据。

## Review Risk

本轮没有获得可用的独立 peer 规格。Story 1A 的 reviewer 必须把目录边界、依赖 checker 和 Runtime 门面作为阻断项复核；若条件允许，应先补一次异构模型或人工架构 review，再执行 Story 1B。
