# Dev Ledger

K01: "AppDatabase 迁移协议与 packaged 证明" — complete
  Commits: 6d0724a
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, .ship/tasks/tgbuddy-vertical-slices/dev-context.md, AGENTS.md, package.json, scripts/check-architecture.ts, scripts/sqlite-spike-main.ts, scripts/sqlite-spike-runtime.ts, scripts/sqlite-spike-scenarios.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/migrations/001_app_bootstrap.sql, src/sql.d.ts, tests/sqlite-spike.test.ts, tests/unit/architecture/import-boundaries.test.ts
  Produces: `AppDatabase.open(databasePath: string): AppDatabase`; `AppDatabase.close(): void`; `AppDatabase.databasePath: string`; packaged `app-database` scenario
  Concerns: none

K02: "SQLite SessionCatalogRepository" — complete
  Commits: e6f94e1
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, .ship/tasks/tgbuddy-vertical-slices/dev-context.md, scripts/sqlite-spike-main.ts, scripts/sqlite-spike-runtime.ts, scripts/sqlite-spike-scenarios.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/migrations/002_app_sessions.sql, src/infrastructure/sqlite/repositories/sqlite-session-repository.ts, src/runtime/index.ts, src/runtime/sessions/session-repository.ts, tests/sqlite-spike.test.ts
  Produces: `SessionRepository`; `SqliteSessionRepository`; packaged `session-catalog` scenario
  Concerns: none

K03: "会话侧栏切换到 SQLite" — complete
  Commits: fcca352
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, .ship/tasks/tgbuddy-vertical-slices/dev-context.md, scripts/sqlite-spike-scenarios.ts, src/infrastructure/sqlite/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/index.ts, src/main/session-store.ts, src/runtime/index.ts, src/runtime/sessions/session-commands.ts, tests/unit/main/session-store-catalog.test.ts, tests/unit/runtime/session-commands.test.ts
  Produces: production `userData/tgbuddy.db` catalog wiring; `createSessionCommands()`; K03–K08 legacy metadata bridge
  Concerns: none

K04: "pi Session backend 适配器" — complete
  Commits: 710c05b
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, .ship/tasks/tgbuddy-vertical-slices/dev-context.md, bun.lock, package.json, scripts/sqlite-spike-main.ts, scripts/sqlite-spike-runtime.ts, scripts/sqlite-spike-scenarios.ts, src/kernel/pi/index.ts, src/kernel/pi/pi-session-store.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/runtime/index.ts, src/runtime/sessions/message-store.ts, src/shared/contracts/message.ts, tests/sqlite-spike.test.ts, tests/unit/kernel/pi-session-store.test.ts
  Produces: `MessageStore`; `PiSessionStore`; packaged `pi-session-store` scenario; 并发生命周期护栏
  Concerns: none

K05: "消息历史切换到 pi Session backend" — complete
  Commits: 8e02761
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, .ship/tasks/tgbuddy-vertical-slices/dev-context.md, scripts/sqlite-spike-scenarios.ts, src/kernel/pi/pi-session-store.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/compaction-service.ts, src/main/ipc.ts, src/main/orchestrator.ts, src/main/session-store.ts, src/runtime/app/tgbuddy-runtime.ts, src/runtime/index.ts, src/runtime/sessions/message-store.ts, src/runtime/sessions/session-commands.ts, src/runtime/sessions/session-message-history.ts, src/shared/contracts/session.ts, tests/integration/session-message-history.test.ts, tests/unit/kernel/pi-session-store.test.ts, tests/unit/runtime/session-commands.test.ts, tests/unit/runtime/tgbuddy-runtime.test.ts
  Produces: `SessionMessageHistory`; async Runtime Session history contract; `pi@0.82` metadata guard; production message/compaction/artifact/delete wiring
  Concerns: history 删除失败会保留不可见 backend 孤儿并记录诊断；canonical catalog 已删除，不产生可见空会话

K06: "legacy JSONL 一次性导入" — complete
  Commits: 7eff451
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, .ship/tasks/tgbuddy-vertical-slices/dev-context.md, AGENTS.md, scripts/sqlite-spike-scenarios.ts, src/infrastructure/sqlite/index.ts, src/infrastructure/sqlite/legacy-importer.ts, src/kernel/pi/index.ts, src/kernel/pi/pi-legacy-importer.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/import-legacy-sessions.ts, src/main/index.ts, src/runtime/sessions/session-message-history.ts, tests/integration/session-message-history.test.ts, tests/sqlite-spike.test.ts
  Produces: production legacy loader/import coordinator; `tgbuddy-jsonl-v1` marker; structured migration diagnostics; packaged first/skip/rebuild/conflict/tail/truncate evidence
  Concerns: 生产文件超过 6 个，因为同一迁移事务必须同时覆盖 parser、pi writer、Composition Root 和现有 history consumer；已由 packaged production path 验证。逐 Slice review 按用户决定从 K07 起改为 K17 后、E2E 前集中执行；K06 的两轮 review findings 已在最终 commit 修复。

K07: "RunRegistry 单 Session 单飞" — complete
  Commits: c354373
  Files: .ship/tasks/tgbuddy-vertical-slices/dev-context.md, .ship/tasks/tgbuddy-vertical-slices/plan/plan.md, AGENTS.md, src/main/bootstrap/create-legacy-runtime.ts, src/main/orchestrator.ts, src/runtime/index.ts, src/runtime/runs/run-coordinator.ts, src/runtime/runs/run-registry.ts, tests/agent-concurrency.test.ts
  Produces: `RunRegistry`; `RunCoordinator`; Runtime-owned generation token; same-Session rejection; cross-Session concurrency; stop-and-wait dispose
  Concerns: AbortController 和迟到 engine event 的完整级联留给 K10；K07 只迁移 active Run 所有权，Main 暂留 Agent executor。

K08: "PiAgentEngine 文本流" — complete
  Commits: 8eb93e0
  Files: AGENTS.md, scripts/probe.ts, scripts/probe-compaction.ts, src/kernel/compaction.ts, src/kernel/pi/index.ts, src/kernel/pi/pi-agent-engine.ts, src/kernel/pi/pi-models.ts, src/kernel/pi/pi-session-store.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/orchestrator.ts, src/runtime/index.ts, src/runtime/runs/agent-engine.ts, src/runtime/runs/run-coordinator.ts, src/shared/channel-presets.ts, src/shared/contracts/channel.ts, tests/agent-concurrency.test.ts, tests/integration/run-coordinator.test.ts, tests/unit/kernel/pi-agent-engine.test.ts, tests/unit/kernel/pi-session-store.test.ts
  Produces: Runtime `AgentEngine` port; production `PiAgentEngine` backed by pi `AgentHarness`; persisted `message_end` envelope; faithful thinking/text/error/stopReason mapping; real-model production probe
  Concerns: K09 接入统一 settled 状态和失败持久化；K10 完成 setup 阶段取消与迟到事件丢弃；K11 再把工具能力装入 Harness。

K09: "Run settled、消息落盘与失败状态" — complete
  Commits: a6ccb48
  Files: AGENTS.md, src/kernel/pi/index.ts, src/kernel/pi/pi-agent-engine.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/ipc.ts, src/renderer/atoms/agent.ts, src/renderer/hooks/useGlobalAgentListeners.ts, src/runtime/app/tgbuddy-runtime.ts, src/runtime/index.ts, src/runtime/runs/run-coordinator.ts, src/runtime/sessions/session-commands.ts, src/shared/contracts/events.ts, tests/agent-concurrency.test.ts, tests/integration/run-coordinator.test.ts, tests/integration/run-settled.test.ts, tests/unit/kernel/pi-agent-engine.test.ts
  Produces: single settled path; running/done/failed Session updates; durable message-before-status ordering; provider final-message error fallback; direct sidebar `session_updated` event; pending request cleanup
  Concerns: aborted 暂按 failed 收口；K10 将引入 Run cancellation scope、setup 阶段取消和迟到帧丢弃，并把用户停止改为 idle。
K10: "Stop、Abort 与迟到事件丢弃" — complete
  Commits: bd2a472
  Files: AGENTS.md, scripts/probe.ts, src/kernel/pi/pi-agent-engine.ts, src/renderer/atoms/agent.ts, src/renderer/hooks/useGlobalAgentListeners.ts, src/runtime/runs/agent-engine.ts, src/runtime/runs/run-coordinator.ts, src/runtime/runs/run-registry.ts, tests/agent-concurrency.test.ts, tests/integration/run-coordinator.test.ts, tests/integration/run-settled.test.ts
  Produces: per-Run AbortController; idempotent stop; AgentHarness AbortSignal cascade; stopped Session idle settlement; Runtime and Renderer late-frame rejection; real-model abort probe
  Concerns: none
K11: "工具调用四态闭环" — complete
  Commits: 460f3d6
  Files: AGENTS.md, scripts/probe.ts, src/kernel/pi/pi-agent-engine.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/tools/index.ts, src/renderer/App.tsx, src/renderer/atoms/agent.ts, src/renderer/components/ToolCard.tsx, src/renderer/hooks/useGlobalAgentListeners.ts, src/runtime/index.ts, src/runtime/runs/agent-engine.ts, src/shared/contracts/events.ts, tests/agent-concurrency.test.ts, tests/integration/run-coordinator.test.ts, tests/integration/run-settled.test.ts, tests/tool-activity.test.ts, tests/unit/kernel/pi-agent-engine.test.ts
  Produces: production Harness tool injection; explicit ToolPolicy port with K11 permissive implementation; tool event output preview; awaiting/running/success/error/unknown UI transitions; eight-line preview; durable history replay
  Concerns: K11 的 permissive ToolPolicy 只负责建立端口，S05 才接真实 allow/ask/deny 决策；Main 工具 factory 按计划保留到 C12。
K12: "重启恢复未完成 Run" — complete
  Commits: 924238e
  Files: .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md, AGENTS.md, scripts/sqlite-spike-scenarios.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/legacy-importer.ts, src/infrastructure/sqlite/migrations/003_app_sessions_interrupted.sql, src/infrastructure/sqlite/repositories/sqlite-session-repository.ts, src/main/bootstrap/create-application.ts, src/renderer/App.tsx, src/runtime/index.ts, src/runtime/runs/run-recovery.ts, src/shared/contracts/session.ts, tests/integration/run-recovery.test.ts
  Produces: startup interrupted recovery; durable session_resumed notice; idempotent recovery report; interrupted sidebar state; forward SQLite migration 003; next-Run recovery proof
  Concerns: catalog 提交优先于 notice；notice 写入失败只上报诊断，不能让会话永久停留 running 或阻止应用启动。

S01: "Workspace catalog 与选择器" — complete
  Commits: 4cb752f
  Files: tests/unit/runtime/session-commands.test.ts, tests/unit/runtime/workspace-service.test.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/infrastructure/sqlite/migrations/004_app_workspaces.sql, src/infrastructure/sqlite/repositories/sqlite-workspace-repository.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/ipc.ts, src/preload/index.ts, src/renderer/App.tsx, src/renderer/atoms/agent.ts, src/runtime/app/agent-runtime.ts, src/runtime/index.ts, src/runtime/sessions/session-commands.ts, src/runtime/workspaces/workspace-repository.ts, src/runtime/workspaces/workspace-service.ts, src/shared/contracts/ipc.ts
  Produces: `WorkspaceRepository`（list/get/create）；`createWorkspaceService()` → `WorkspaceService`（list/create/select/current/ensureDefault，路径端口注入）；`SqliteWorkspaceRepository` + `004_app_workspaces.sql`；IPC `workspace:list/create/select/current/pick`；Preload `window.tgbuddy.workspace`；Renderer 侧栏选择器 + `workspacesAtom`/`currentWorkspaceIdAtom`；`CreateSessionCommandsOptions.workspaceId`（list 按当前工作区过滤、create 绑定工作区）；bootstrap `ensureDefault(process.cwd())` 承接无工作区会话
  Concerns: 生产文件 18 个超过 6 个护栏，因为 S01 是完整 Runtime→IPC→Renderer 纵向切片且每个文件单一职责；SQLite adapter 沿用 K02 已 packaged 证明的 repository 模式，未新增 spike 场景（S01 计划验证为 test+build+dev）；交互式"选择两个目录"验证按用户流程并入 M2 QA 阶段统一执行。自审（用户策略调整后按复杂度判断）：run cwd 仍走 `DATA_DIR/workspaces/<id>`，未使用所选目录属 S02/S03 mount/ExecutionEnv 范畴，按计划推迟，非回归。

S02: "Workspace mount 可用性" — complete
  Commits: ae55faa
  Files: src/shared/contracts/workspace.ts, src/runtime/workspaces/workspace-mount-resolver.ts, src/runtime/workspaces/workspace-service.ts, src/runtime/app/agent-runtime.ts, src/runtime/index.ts, src/infrastructure/workspace/index.ts, src/infrastructure/workspace/node-workspace-mount-resolver.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/shared/contracts/ipc.ts, src/main/ipc.ts, src/preload/index.ts, src/renderer/App.tsx, tests/unit/infrastructure/workspace-mount-resolver.test.ts, tests/unit/runtime/workspace-mount.test.ts, tests/unit/runtime/workspace-service.test.ts, tests/integration/run-coordinator.test.ts
  Produces: `WorkspaceMountResolver` 端口 + `mountFailureMessage()`；`NodeWorkspaceMountResolver`（每次调用重新 stat/access，不缓存永远有效的路径）；`WorkspaceCommands.mountStatus()`；IPC `workspace:mount-status` + Preload/侧栏不可用提示；`createAgentInvocation` 每次 run 前 resolve mount，失败抛可恢复动作错误（RunCoordinator 以 failed + host_error 可见，engine 不执行）
  Concerns: Windows 上无法可靠模拟 EACCES，unreadable 分支无单测（与 missing 同构，靠代码审查）；run cwd 从 `DATA_DIR/workspaces/<id>` 切换为真实 mount.path，属 S02 目标行为。

S03: "per-run ExecutionEnv 基础隔离" — complete
  Commits: e8d39ff
  Files: scripts/check-architecture.ts, scripts/probe.ts, src/kernel/pi/index.ts, src/kernel/pi/pi-agent-engine.ts, src/kernel/pi/pi-execution-env.ts, src/kernel/pi/pi-sandbox.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/tools/index.ts, src/main/tools/sandboxed-env.ts, src/runtime/index.ts, src/runtime/runs/agent-engine.ts, src/runtime/execution-env/run-execution-env.ts, tests/integration/run-coordinator.test.ts, tests/unit/kernel/pi-execution-env.test.ts, tests/unit/kernel/pi-sandbox.test.ts
  Produces: `RunExecutionEnv`/`RunExecutionEnvFactory` 端口（pi-free）；`PiRunExecutionEnv`/`PiRunExecutionEnvFactory`（每 Run 独立沙箱，dispose → NodeExecutionEnv.cleanup 结束残留后台 shell）；`createSandboxedEnv` + `resolveSandboxedPath` 从 main/tools 迁至 kernel/pi；`AgentInvocation.workspaceId`；engine 在 run 内 try/finally 创建/释放 env；`buildBuiltinTools(cwd, env)` 改用注入 env
  Concerns: kernel `pi-sandbox.ts` 与旧 `main/tools/sandbox.ts` 存在临时路径规则重复（旧 owner 只服务 delete/glob，S11 删除）；engine 级"settle 后释放"由代码结构保证，env dispose 幂等有单测，未做完整 harness 级集成测试；architecture checker 的 runtime port 后缀新增 `env`。

S04: "canonical path 与逃逸拒绝" — complete
  Commits: 410cebd
  Files: src/kernel/pi/pi-execution-env.ts, src/kernel/pi/pi-sandbox.ts, src/main/tools/sandbox.ts, tests/unit/kernel/pi-execution-env.test.ts, tests/unit/kernel/pi-sandbox.test.ts
  Produces: `resolveSandboxedPath`/`assertContainedPath` 补全 canonical 判定：`..`、绝对外部路径、symlink/junction 逃逸一律拒绝；不存在目标按最近已存在父目录判断；合法子路径大小写归一后放行；Windows 路径测试覆盖
  Concerns: 旧 `main/tools/sandbox.ts` 的 delete/glob 路径规则与 kernel 新实现临时重复，S11 删除旧 owner；拒绝结论不依赖 Renderer（工具卡失败态沿用现有 error 呈现）。

S05: "PolicyEngine 基础决策" — complete
  Commits: 0eb7f60
  Files: src/main/bootstrap/create-application.ts, src/runtime/index.ts, src/runtime/permissions/permission-rule-repository.ts, src/runtime/permissions/policy-engine.ts, src/shared/contracts/permission.ts, tests/unit/runtime/policy-engine.test.ts
  Produces: `ToolPolicy` 生产实现 `createPolicyEngine({ rules, getMode, getWorkspaceId, ask })`；`PermissionRuleRepository` 端口 + `MemoryPermissionRuleRepository`（S05 只有 list，S07 补 SQLite 与 add/remove）；决策纯函数化：模式（plan/auto/bypass）、读工具默认 allow、写与命令默认 ask、deny 规则直接拒绝、neverPersist 跳过规则直接询问、系统级命令默认 deny；`PermissionAskInput`；ask 落点仍委托 legacy permission-service（S06 迁入 Runtime broker）
  Concerns: 生产 ask 仍走 Main `PendingRequests`，属 S06 明确迁移项；规则持久化未接入（S07）；S05 的 `assessRisk`/`suggestGrants` 仍在 legacy permission-service，S06 一并迁入 Runtime。

S06: "inline 权限队列与重载恢复" — complete
  Commits: 7760e5e
  Files: src/runtime/pending/pending-requests.ts, src/runtime/permissions/permission-ask-broker.ts, src/runtime/index.ts, src/main/pending-request.ts（删除）, src/main/ask-user-service.ts, src/main/plan-service.ts, src/main/permission-service.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/renderer/atoms/agent.ts, src/renderer/components/ToolCard.tsx, src/renderer/hooks/useGlobalAgentListeners.ts, tests/pending-request.test.ts, tests/unit/runtime/permission-ask-broker.test.ts
  Produces: `PermissionAskBroker`（Runtime 持有挂起注册表：ask/respond/pending/clearSession，`ask` 经 `PendingRequests` 挂起，respond 只按 requestId 兑现）；`createPermissionAskBroker({ createId, emitRequest })` + `assessRisk`/`suggestGrants`（从 legacy 迁入 Runtime）；`PendingRequests` 泛型注册表迁至 `src/runtime/pending/`（去掉 node:crypto，ID 由调用方注入/生成，S09/S10 复用同一机制）；生产 ask 落点改走 broker，旧 Main pending service 不再接新请求；Renderer 工具卡新增 `denied`（已拒绝）状态（原型 ST 灰 #8a8a92），`permission_resolved { allowed:false }` 把卡片从等待授权落为已拒绝
  Concerns: 生产文件 14 个超过 6 个护栏：挂起注册表迁入 Runtime 必须同步更新 3 个 legacy 使用方（ask-user/plan/permission 均为机械换 import + ID 生成）；denied 只作用于实时卡片，历史回放仍以 unknown（未完成）呈现，属 S08/S11 范围；broker 不建规则（grant 字段暂不落库），S07 接 SQLite `PermissionRuleRepository`；renderer 恢复竞态沿用既有「先订阅后快照 + revision 校验」，未新增 hook 级测试（agent-concurrency.test.ts 已覆盖 merge/index 语义）。

S07: "「总是允许」规则持久化" — complete
  Commits: 6ef5f4f
  Files: src/shared/contracts/permission.ts, src/runtime/permissions/permission-rule-repository.ts, src/runtime/permissions/permission-ask-broker.ts, src/runtime/app/agent-runtime.ts, src/infrastructure/sqlite/migrations/005_app_permission_rules.sql, src/infrastructure/sqlite/repositories/sqlite-permission-rule-repository.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/ipc.ts, src/main/permission-service.ts, src/preload/index.ts, src/shared/contracts/ipc.ts, src/renderer/atoms/agent.ts, src/renderer/hooks/useGlobalAgentListeners.ts, src/renderer/App.tsx, tests/unit/runtime/permission-rules.test.ts, tests/unit/runtime/policy-engine.test.ts, scripts/sqlite-spike-scenarios.ts, scripts/sqlite-spike-runtime.ts, scripts/sqlite-spike-main.ts, tests/sqlite-spike.test.ts
  Produces: `PermissionRule` 增加 `id`/`source`/`reason`；`PermissionRuleRepository` 端口补齐 `add/remove`（Memory 实现去重幂等）；`createPermissionAskBroker` 增加 `applyGrant` 落点（Composition Root 按 scope 解析 ownerId：session→sessionId、project→workspaceId、global→undefined，reason/source 记录来源）；`SqlitePermissionRuleRepository` + `005_app_permission_rules.sql`（UNIQUE(tool,match,pattern,scope,owner_id)，重复 grant DO NOTHING 幂等，owner_id 空串归一）；生产 PolicyEngine 规则源切换 SQLite，`expireSessionRules` 改为按 ownerId 删除 session 规则；IPC `permission:rules`/`permission:rule-remove` + Preload + 侧栏最小规则列表（可删除，正式设置页 U04）；packaged spike 新增 `permission-rules` 场景（写入/去重/删除/跨 reopen 字段保真），app-database 场景迁移表断言补 004/005
  Concerns: 生产文件 16 个超过 6 个护栏：一个纵向切片（契约→Runtime→SQLite→IPC→Renderer）且每文件单一职责；spike 场景扩展为既有框架同步改动；legacy `permissions.json` 规则未被迁移（S05 起生产已不读它，属预发布数据；若需保留用户资产需补一次性迁移决策）；hits 计数仍为 0，设置页展示留 C12/U04；规则列表 UI 是临时最小出口，U04 正式设置页替换。
