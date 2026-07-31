# TgBuddy 目标代码仓库设计规格

> 基线：`main@fc8a3d11a6f8257d9b6dfe700a9cf0e8d181b964`
>
> 本规格服从 `docs/01-架构设计.md`、`docs/02-功能范围.md`、`docs/06-设计决策.md`。不再把 `src/` 文件数作为约束；优先保证职责单一、依赖单向、功能覆盖完整。

## Problem / Motivation

现有架构文档已经决定 Workspace、Run、AgentHarness、SQLite、BlobStore、PolicyEngine、MCP、Skill 和单层 child delegation 的系统语义，但没有给出这些概念在代码仓库中的归属和依赖方向。

当前实现因此形成两个职责汇聚点：

- `src/main/` 同时包含 Electron 宿主、Agent 编排、领域状态、JSONL 存储、权限策略和 Node 文件系统适配。
- `src/renderer/App.tsx` 与单个 `atoms/agent.ts` 同时承载会话列表、对话、运行、权限、计划、问答、压缩和结果区状态。

这不是单纯的“大文件”问题。更关键的问题是边界不可验证：

- `src/main/orchestrator.ts` 直接创建 pi `Agent`，同时读取渠道、构造工具、配置全局 sandbox、持久化消息并调度压缩。
- `src/main/session-store.ts` 把会话领域语义、JSONL 编解码、索引文件和文件系统 I/O 放在同一模块。
- `src/main/ipc.ts` 直接调用所有 service/store，Electron handler 成为应用服务定位器。
- `src/shared/ipc.ts` 明示新增能力要同步四处，契约漂移只能靠人工避免。
- Renderer 的全局监听器必须理解全部 host event，功能增加后会继续膨胀。

目标不是为了“分层”而增加目录，而是让每个业务能力有明确 owner，让 Electron、pi、SQLite、Node 文件系统和 React 都成为可替换的边缘适配器。

## Goals

1. 给出覆盖第一版全部功能的目标目录、模块职责和依赖规则。
2. 建立一个不依赖 Electron/React 的仓库内 Runtime，由 Electron 作为参考宿主调用。
3. 把 pi 运行时调用收口到 `src/kernel/pi/`，保留现有“消息不归一化、事件归一化”的设计决策。
4. 让 SQLite app 表、pi 私有 Session 表、BlobStore、JSONL 导入导出各自有明确 owner。
5. 让 Workspace、Session、Run、Permission、Plan、Artifact、MCP、Skill、Profile 和 Delegation 的生命周期可独立测试。
6. 用自动化 import-boundary 检查防止依赖重新渗透。
7. 允许按阶段迁移；每个阶段结束时应用仍可运行，不做一次性推倒重写。

## Non-goals

- 不设计独立 npm SDK、第三方插件 ABI、通用 DI 容器或反射式模块系统。
- 不改变已定的产品范围：不做 Chat mode、完整 Team DAG、并行/chain/router、会话分支树、向量数据库。
- 不把 Runtime 拆成多个进程或服务。
- 不重新讨论 SQLite 与 JSONL 的取舍；packaged spike 已通过，目标是生产接入 SQLite。
- 不以目录数量、文件数量或“每个文件最多多少行”作为验收标准。
- 本设计阶段不移动生产代码，不覆盖工作树中已有的 README/docs 改动。

## Design Approach

采用“领域模块化 Runtime + 边缘 Adapter + 显式 Composition Root”。

```text
Renderer ──typed IPC──> Electron Main ──> TgBuddyRuntime
                                            │
                     ┌──────────────────────┼──────────────────────┐
                     ▼                      ▼                      ▼
                Kernel ports          Persistence ports      Host ports
                     │                      │                      │
                pi adapters           SQLite / Blob          MCP / secrets /
                                                            filesystem
```

核心规则：

1. `runtime` 负责业务语义和用例，不 import Electron、React、Node 文件系统、SQLite 或 pi。
2. `kernel/pi` 实现 Runtime 所需的 Agent engine、Session backend、模型、压缩和 Skill loader 端口；只有这里允许 pi 运行时调用。
3. `infrastructure` 实现 app 数据、Blob、文件系统、Secret 和 MCP transport 端口。
4. `main` 只做 Electron 生命周期、窗口、IPC 和依赖装配，不实现业务规则。
5. `renderer` 只依赖可序列化 contract 和 preload 暴露的 API，不 import Runtime。
6. `shared/contracts` 只放跨进程/跨边界稳定数据。pi 消息类型可按已定决策出现在消息信封中，但不能从这里触发 pi 运行时。

## Target Repository Layout

```text
src/
├─ shared/
│  ├─ contracts/
│  │  ├─ ids.ts
│  │  ├─ workspace.ts
│  │  ├─ session.ts
│  │  ├─ run.ts
│  │  ├─ message.ts
│  │  ├─ events.ts
│  │  ├─ permission.ts
│  │  ├─ capability.ts
│  │  ├─ artifact.ts
│  │  ├─ channel.ts
│  │  ├─ context.ts
│  │  └─ ipc.ts
│  ├─ errors.ts
│  └─ index.ts
│
├─ runtime/
│  ├─ app/
│  │  ├─ tgbuddy-runtime.ts
│  │  └─ runtime-events.ts
│  ├─ workspaces/
│  │  ├─ workspace-service.ts
│  │  ├─ workspace-repository.ts
│  │  └─ mount-resolver.ts
│  ├─ sessions/
│  │  ├─ session-service.ts
│  │  ├─ session-repository.ts
│  │  └─ session-transfer.ts
│  ├─ runs/
│  │  ├─ run-coordinator.ts
│  │  ├─ run-registry.ts
│  │  ├─ run-budget.ts
│  │  ├─ cancellation-scope.ts
│  │  └─ agent-engine.ts
│  ├─ context/
│  │  ├─ context-service.ts
│  │  └─ compaction-policy.ts
│  ├─ permissions/
│  │  ├─ policy-engine.ts
│  │  ├─ permission-service.ts
│  │  ├─ permission-repository.ts
│  │  └─ permission-broker.ts
│  ├─ plans/
│  │  ├─ plan-service.ts
│  │  └─ plan-repository.ts
│  ├─ questions/
│  │  └─ ask-user-service.ts
│  ├─ channels/
│  │  ├─ channel-service.ts
│  │  ├─ channel-repository.ts
│  │  └─ secret-store.ts
│  ├─ capabilities/
│  │  ├─ capability-assembler.ts
│  │  ├─ profiles/
│  │  │  ├─ profile-service.ts
│  │  │  └─ profile-repository.ts
│  │  ├─ tools/
│  │  │  ├─ tool-registry.ts
│  │  │  ├─ tool-runtime.ts
│  │  │  └─ builtin/
│  │  ├─ skills/
│  │  │  ├─ skill-registry.ts
│  │  │  └─ skill-loader.ts
│  │  └─ mcp/
│  │     ├─ mcp-manager.ts
│  │     ├─ mcp-repository.ts
│  │     └─ mcp-transport.ts
│  ├─ artifacts/
│  │  ├─ artifact-service.ts
│  │  ├─ artifact-repository.ts
│  │  ├─ blob-store.ts
│  │  └─ tool-result-projector.ts
│  ├─ delegation/
│  │  ├─ delegation-service.ts
│  │  └─ delegation-policy.ts
│  ├─ observability/
│  │  └─ runtime-metrics.ts
│  └─ index.ts
│
├─ kernel/
│  └─ pi/
│     ├─ pi-agent-engine.ts
│     ├─ pi-session-backend.ts
│     ├─ pi-model-catalog.ts
│     ├─ pi-message-adapter.ts
│     ├─ pi-event-adapter.ts
│     ├─ pi-compaction-adapter.ts
│     ├─ pi-skill-loader.ts
│     └─ pi-tool-adapter.ts
│
├─ infrastructure/
│  ├─ sqlite/
│  │  ├─ app-database.ts
│  │  ├─ migrations/
│  │  ├─ repositories/
│  │  ├─ jsonl-importer.ts
│  │  ├─ jsonl-exporter.ts
│  │  └─ backup-service.ts
│  ├─ filesystem/
│  │  ├─ canonical-path.ts
│  │  ├─ sandboxed-execution-env.ts
│  │  └─ file-blob-store.ts
│  ├─ secrets/
│  │  └─ electron-secret-store.ts
│  └─ mcp/
│     └─ stdio-mcp-transport.ts
│
├─ main/
│  ├─ bootstrap/
│  │  └─ create-application.ts
│  ├─ ipc/
│  │  ├─ register-ipc.ts
│  │  ├─ session-handlers.ts
│  │  ├─ run-handlers.ts
│  │  ├─ interaction-handlers.ts
│  │  └─ settings-handlers.ts
│  ├─ lifecycle.ts
│  ├─ window.ts
│  └─ index.ts
│
├─ preload/
│  └─ index.ts
│
└─ renderer/
   ├─ app/
   │  ├─ App.tsx
   │  ├─ providers.tsx
   │  └─ global-event-bridge.tsx
   ├─ features/
   │  ├─ workspaces/
   │  ├─ sessions/
   │  ├─ conversation/
   │  ├─ run-control/
   │  ├─ permissions/
   │  ├─ plans/
   │  ├─ questions/
   │  ├─ artifacts/
   │  ├─ capabilities/
   │  └─ settings/
   └─ shared/
      ├─ components/
      ├─ state/
      ├─ lib/
      └─ styles/

tests/
├─ unit/
│  ├─ runtime/
│  ├─ kernel/
│  └─ renderer/
├─ integration/
│  ├─ sqlite/
│  ├─ ipc/
│  ├─ filesystem/
│  └─ mcp/
├─ e2e/
└─ fixtures/

scripts/
├─ check-architecture.ts
├─ probe.ts
└─ sqlite-spike-*.ts
```

目录是职责地图，不要求为每个名字预先创建空文件。功能迁移到某个模块时才创建其实现和测试。

## Module Responsibilities

### `shared/contracts`

- 定义跨 Renderer、Preload、Main、Runtime 和持久化边界传输的 ID、DTO、事件和错误码。
- 所有 contract 必须可序列化；不得含 Electron handle、数据库连接、文件描述符或 service 实例。
- `message.ts` 保留当前 pi message 信封与 `kernel: 'pi@0.82'` 版本护栏，不重新发明消息格式。
- `events.ts` 继续保持 `agent` / `host` 双通道，并统一携带 `workspaceId`、`sessionId`、`rootRunId`、`agentRunId`、`parentToolCallId?`。
- `ipc.ts` 用一个 command/event map 定义请求和响应；Preload 的友好 API 用 `satisfies TgBuddyAPI` 做编译期校验。

### `runtime/app`

- 对宿主暴露唯一应用门面 `TgBuddyRuntime`。
- 接收显式依赖，不读取全局变量，不自行创建 SQLite、Electron 窗口或 Node 文件系统实例。
- 对外只暴露 command 方法、查询方法、event subscribe 和 `dispose()`。
- 不把内部 service/repository 暴露给 IPC。

建议的最小门面：

```ts
export interface TgBuddyRuntime {
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  runs: RunCommands
  permissions: PermissionCommands
  plans: PlanCommands
  questions: AskUserCommands
  artifacts: ArtifactQueries
  capabilities: CapabilityCommands
  settings: SettingsCommands
  subscribe(listener: RuntimeEventListener): () => void
  dispose(): Promise<void>
}
```

### `runtime/workspaces`

- Workspace 是逻辑实体，Mount 是可替换的物理绑定。
- `MountResolver` 每次 Run 开始时解析并验证当前 Mount，返回不可变的 run-scoped snapshot。
- 重新绑定只更新 Mount，不修改 Session、PermissionRule、Plan 或 Artifact 的 workspace 归属。
- 不允许自动把未知 Workspace 映射为 `~/.tgbuddy/workspaces/{id}`。

### `runtime/sessions`

- 管 Session catalog、线性消息视图、软 truncate、originRef、导入导出和删除用例。
- 删除用例先调用 RunCoordinator 级联 abort，再清 pending request，最后事务删除 app 数据和 pi Session。
- `SessionRepository` 是 app 领域接口；不泄漏 pi 私有表。

### `runtime/runs`

- `RunCoordinator` 是一次用户输入的唯一编排入口。
- `RunRegistry`、`RunBudget`、`CancellationScope` 都是 Runtime 实例成员，不使用模块级全局 Map。
- 创建 root Run、恢复 Session、固定 WorkspaceMount snapshot、装配能力、调用 `AgentEngine`、持久化完成事件并发布 RuntimeEvent。
- 失败、取消和存储降级走统一终态，确保 settled 后没有遗留 Agent、child、权限、计划或问答。

### `runtime/context`

- 管上下文分类预算、85% 自动压缩策略、3 秒 defer 和压缩状态机。
- pi 的 token 估算和实际 compaction 由 kernel adapter 完成；Runtime 只持有中立的输入输出。
- `skills`、`mcp` 分类不能永远为 0；能力装配时必须提供真实预算贡献。

### `runtime/permissions`

- `PolicyEngine` 是纯决策模块：Mode、Rule、Tool descriptor、Workspace、RunLineage -> allow/ask/deny。
- `PermissionBroker` 只管理 pending 生命周期、AbortSignal 和响应匹配。
- Rule 默认绑定 `workspaceId`；session/global scope 使用显式 owner 字段，不复用含义模糊的 `ownerId`。
- MCP 必须按 `server.method` 和读写风险判定，禁止 `mcp__` 前缀整体放行。
- `neverPersist` 的破坏性操作只能逐次授权。

### `runtime/plans` 与 `runtime/questions`

- 复用通用 pending request primitive，但保留独立业务语义和 contract。
- Plan 审批结果持久化到 SQLite；ask_user 只持久化需要恢复/审计的结果。
- Session/root abort 会取消所有对应等待。

### `runtime/channels`

- 管渠道、模型选择和脱敏状态。
- API key 通过 `SecretStore` 单独保存；ChannelRepository 不保存明文密钥。
- Renderer 永远拿不到完整 API key。

### `runtime/capabilities`

- `CapabilityAssembler` 根据 Profile + Workspace + Mode + MCP status 构造一次 Invocation 的能力快照。
- Tool Registry 统一内置 Tool、MCP Tool 和 root-only delegation Tool。
- Skill Registry 默认只提供 manifest 摘要，正文按需通过受限 loader 读取。
- MCP Manager 拥有 server 生命周期、工具发现、断线剔除、诊断和长输出 Blob 化；transport 是基础设施端口。
- Profile 只描述能力组合，不拥有运行状态。

### `runtime/artifacts`

- ToolResultProjector 从工具参数和结果建立 Artifact；不能依赖可选 `details`。
- BlobStore 保存附件原图、预览、完整工具输出和非 Workspace 产物。
- 消息和 SQLite app 表只保存 BlobRef/ArtifactRef。
- 结果区是 Artifact 投影，只读展示，不成为第二套文件编辑器。

### `runtime/delegation`

- 只实现同步单层 child。
- root 最多启动 2 个 child、最大深度 1，失败也计数；child 能力快照不含 delegation Tool。
- root/child 共享 root budget 和 CancellationScope。
- child 的事件、权限、产物、token 和结果必须带完整 lineage。

### `kernel/pi`

- 这是 pi 运行时唯一边界：AgentHarness、Models、Session backend、compaction、Skill loader 和 tool hook 适配都在这里。
- `PiAgentEngine` 实现 Runtime 的 `AgentEngine` 端口，向外只发规范化 AgentEvent。
- pi SQLite backend 私有表由 `PiSessionBackend` 管理；与 `app_*` 表共享数据库文件可以，但不得跨表 FK、Trigger 或直接查询内部字段。
- 消息保持 pi 原始格式；事件、错误和 tool lifecycle 在 adapter 中收敛。

### `infrastructure`

- `sqlite` 只实现 app repositories、migration、backup 和 JSONL transfer；业务决策留在 Runtime。
- `filesystem` 做 canonical path 校验，必须覆盖 symlink、junction、Windows reparse point；`SandboxedExecutionEnv` 每个 Run 独立。
- `secrets` 用 Electron safeStorage 或系统钥匙串实现 SecretStore。
- `mcp` 只负责 stdio/process transport，不决定权限或能力是否可见。

### `main`

- `create-application.ts` 是唯一 Composition Root，显式实例化 Database、repositories、BlobStore、SecretStore、MCP transport、PiAgentEngine 和 TgBuddyRuntime。
- IPC handler 只做输入校验、调用 Runtime 门面、把错误映射为 contract；不 import repository 或具体 service。
- 生命周期负责启动迁移、恢复 pending 状态、窗口关闭时 `runtime.dispose()`。

### `renderer`

- `app` 只做三栏布局、Provider 和全局事件桥。
- 每个 feature 拥有自己的 atoms/reducer、queries、actions 和 UI。
- 全局事件桥只做 frame 路由和 stale run 过滤；具体 event reducer 下沉到对应 feature。
- 会话、运行、权限、计划、问答、产物、能力和设置不再共享一个总 atom 文件。
- UI 数值和交互继续以 `tgbuddy-mockup/TgBuddy 交互原型.dc.html` 为唯一事实来源。

## Allowed Dependency Direction

```text
shared/contracts
      ▲
      │
runtime ────────────────┐
  ▲                     │ ports
  │ implements          ▼
kernel/pi        infrastructure
      ▲                 ▲
      └────────┬────────┘
               │
              main <── preload <── renderer
```

实际 import 规则：

| From | Allowed | Forbidden |
|---|---|---|
| `shared` | type-only pi message types | runtime、kernel implementation、infrastructure、main、preload、renderer |
| `runtime` | shared、runtime 内部模块 | pi、Electron、React、node:fs/path/sqlite、infrastructure、main |
| `kernel/pi` | shared、runtime ports、pi packages | main、preload、renderer、infrastructure repositories |
| `infrastructure` | shared、runtime ports、Node/Electron adapter API | renderer、preload、main business handler、kernel implementation |
| `main` | shared、runtime public API、kernel/infrastructure factories、Electron | renderer implementation |
| `preload` | shared IPC contract、Electron bridge | runtime、kernel、infrastructure、main implementation |
| `renderer` | shared contract、renderer modules、preload global API | runtime、kernel、infrastructure、main、node:*、electron |

补充判定：

- 扫描范围固定为 `src/**/*.{ts,tsx}`，排除 `.d.ts` 和构建产物。
- 除了 `shared/contracts/message.ts`、`shared/contracts/events.ts` 对 pi package 的 type-only import，`import type` 与 value import 一样计入层间依赖。
- `main/bootstrap/**` 是唯一可同时 import Runtime public API、kernel factory 和 infrastructure factory 的 Composition Root。
- `main/ipc/**` 只能 import `src/runtime/index.ts` 暴露的公共门面和 shared contract，不能穿透到 Runtime 内部模块或 concrete repository。
- Renderer 通过 `window.tgbuddy` 使用 Preload，不在源码层 import `preload`。
- checker 必须解析相对路径、当前 `@/` alias 和后续明确配置的 layer alias；违规时逐条输出 source、target、rule 并以非零退出码结束。

单靠 code review 不算完成。

## Data Ownership

| Data | Canonical owner | Notes |
|---|---|---|
| Workspace / Mount | app SQLite repository | Mount 可重绑定 |
| Session catalog / originRef | app SQLite repository | 与 pi session id 显式映射 |
| pi Session entries | pi SQLite backend | 私有表，不跨表依赖 |
| Run / lineage / budget result | app SQLite repository | 高频 delta 不逐条落库 |
| PermissionRule / Plan | app SQLite repository | 默认 workspace scope |
| MCP / Profile / Artifact index | app SQLite repository | Secret 分离 |
| Attachment / full tool output | BlobStore | SQLite 只存 ref 与 metadata |
| API key | SecretStore | Renderer 只见脱敏状态 |
| JSONL | importer/exporter/recovery | 非 canonical |

一个业务动作需要同时更新多个 app 表时，由 app SQLite adapter 提供事务；pi 私有 Session 写入不能假装与 app 表形成跨实现原子事务。RunCoordinator 使用“先记录 pending/intent，后写 pi 完成消息，再提交 app terminal state”的可恢复协议，并在启动时修复非终态 Run。

## Key Runtime Flows

### Send

1. IPC 校验 `workspaceId/sessionId/text/attachmentRefs`。
2. Runtime 加载 Session 并解析当前 WorkspaceMount snapshot。
3. RunCoordinator 创建 root Run、budget 和 cancellation scope。
4. CapabilityAssembler 生成 Invocation snapshot。
5. PiAgentEngine 恢复 Harness Session 并执行。
6. PolicyEngine 对每个 Tool/MCP/delegation preflight。
7. message_end、权限决策、ArtifactRef 和终态持久化；delta 只实时发送。
8. settled 后清理所有 run-scoped 资源。

### Delete Session

1. 标记 Session 为 deleting，拒绝新 Run。
2. 级联 abort root/child 和 pending interactions。
3. 等待 settled。
4. 删除 pi Session、app Session/Run/Plan/Permission session scope/Artifact ownership。
5. 只删除无引用 Blob；Workspace 文件不自动删除。

### Startup Recovery

1. 打开 SQLite、执行 app migration，pi backend 自管其 migration。
2. 检查 integrity/版本和上次 checkpoint。
3. 把 running/pending Run 恢复为 interrupted，不把半个 delta 当消息。
4. 恢复允许跨重启显示的 pending/Plan；无法恢复的等待明确取消。
5. 验证 Blob 索引与文件存在性，缺失项标记 degraded。

## Current-to-Target Mapping

| Current | Target |
|---|---|
| `src/main/orchestrator.ts` | `runtime/runs/*` + `kernel/pi/pi-agent-engine.ts` |
| `src/main/session-store.ts` | `runtime/sessions/*` + `infrastructure/sqlite/repositories/*` + JSONL transfer |
| `src/main/compaction-service.ts` | `runtime/context/*` + `kernel/pi/pi-compaction-adapter.ts` |
| `src/main/permission-service.ts` | `runtime/permissions/*` + SQLite repository |
| `src/main/plan-service.ts` | `runtime/plans/*` |
| `src/main/ask-user-service.ts` | `runtime/questions/*` |
| `src/main/channel-store.ts` | `runtime/channels/*` + SQLite + SecretStore |
| `src/main/tools/*` | Runtime Tool Registry/builtin + filesystem ExecutionEnv + pi tool adapter |
| `src/kernel/*.ts` | `src/kernel/pi/*`，补 AgentHarness/Session/Skill adapter |
| `src/main/ipc.ts` | feature handlers，只依赖 `TgBuddyRuntime` |
| `src/renderer/App.tsx` | `renderer/app` 布局 + feature screens/components |
| `src/renderer/atoms/agent.ts` | 各 feature state/reducer |
| `useGlobalAgentListeners.ts` | app event router + feature reducers |

迁移时允许短期 compatibility adapter，但必须写删除条件和目标阶段；禁止保留两套 canonical store 或两套 RunCoordinator。

## Acceptance Criteria

1. 仓库存在书面目录设计和自动 import-boundary 检查；违规 fixture 测试能证明 checker 会失败。
2. `src/runtime/**` 不 import Electron、React、Node 文件系统、SQLite 或 pi；Runtime 可在 Bun 单测中用内存 adapter 启动。
3. 所有 pi 运行时调用只出现在 `src/kernel/pi/**`；现有 `src/main/orchestrator.ts`、`src/main/tools/**` 的 pi import 全部移除。
4. Electron IPC handler 只依赖 `TgBuddyRuntime` 公共门面；不存在 handler 直接调用 repository/store。
5. SQLite 是 Workspace、Session catalog、Run、PermissionRule、Plan、MCP、Profile、Artifact 索引的 canonical store；JSONL 仅用于导入、导出、审计和恢复。
6. app 表与 pi 私有表无跨表 FK、Trigger 和内部字段查询；schema 测试自动验证。
7. 两个并发 Session 使用各自 Mount snapshot 和 SandboxedExecutionEnv，不共享全局 sandbox 配置。
8. canonical path 测试覆盖普通越界、symlink、junction/reparse point 和敏感目录。
9. MCP Tool 不按前缀整体放行；server 断线后下一轮能力快照不再包含其 Tool，并发布可恢复 host error。
10. Skill 默认只加载摘要，正文按需加载且不能通过路径越出 Workspace/内置目录。
11. 附件、完整工具输出和非 Workspace Artifact 落 BlobStore；消息没有完整 Base64 或无限大输出。
12. root 第三个 child 被预算拒绝；child 无 delegation Tool；root cancel 级联 child、权限、计划和问答。
13. Session 删除先 abort 并 settled，再删除；重启恢复最后完整 message_end，不恢复半个 delta。
14. Renderer 三栏和既定交互保持；结果区能按产生者投影 Artifact，权限/计划/问答状态切换 Session 不丢。
15. `bun run typecheck`、`bun test`、`bun run build`、architecture check 和关键 packaged SQLite gate 全部通过。

## Risks / Unknowns

- pi `AgentHarness` 与当前裸 Agent 的实际 API 差异需要在第一迁移波中用 installed 0.82.1 声明和 probe 固定，不从旧印象实现。
- app SQLite 与 pi backend 的提交无法做跨私有实现 transaction，必须用可恢复状态机而不是伪造原子性。
- Windows canonical path 对不存在的待创建路径、junction 和 reparse point 的处理必须单独设计和测试。
- safeStorage 在不同 Windows 用户/安装方式下的可用性与迁移策略需要 runtime QA。
- MCP transport、Skill loader 和 child delegation 尚无现有生产实现，计划必须先定义窄端口再引入实现。
- 大规模目录移动容易制造长时间双实现；每个阶段必须删除旧 owner，不能只加 wrapper。

## Test Plan

- Unit：PolicyEngine、RunBudget、CancellationScope、compaction policy、Artifact projection、feature reducers。
- Contract：IPC map、Runtime façade、Repository/BlobStore/SecretStore/AgentEngine adapters。
- Integration：SQLite migration/recovery、JSONL import/export、Blob cleanup、canonical path、MCP lifecycle、Electron IPC。
- E2E：功能范围中的 7 个验收场景，尤其是 Workspace relocate、并发隔离、MCP 断线、child budget/cancel、强杀恢复。
- Architecture：对每个禁止依赖方向放置最小 fixture，验证 checker 既能通过正常树也能拒绝违规 import。

## Delivery Order

本仓库设计不改变 README 已定的产品阶段：

1. Phase 0 SQLite packaged spike 已完成。
2. Phase 1 Session Runtime 内部分成三个可 review 的实施单元：仓库边界与 Runtime 门面、SQLite SessionRepo、AgentHarness/Run 生命周期。
3. 然后依次进入 Workspace 与安全、Blob 与产物、能力系统、单层委派、UI 与恢复验收。

因此“仓库边界”不是插在 SQLite spike 与 Session Runtime 之间的新阶段，而是 Session Runtime 的第一步。
