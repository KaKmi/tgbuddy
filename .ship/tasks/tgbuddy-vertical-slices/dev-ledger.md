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
  Produces: `createSandboxPathContext`（每 env 一次 realpath 根）+ `resolveSandboxedPath(path, context)` canonical containment：`..`、绝对外部路径、symlink/junction 逃逸一律拒绝；不存在目标按最近已存在父目录判断；大小写不同合法路径不误拒；Windows 路径测试覆盖
  Concerns: 旧 `main/tools/sandbox.ts` 的 delete/glob 路径规则与 kernel 新实现临时重复，S11 删除旧 owner；拒绝结论不依赖 Renderer（工具卡失败态沿用现有 error 呈现）。

S05: "PolicyEngine 基础决策" — complete
  Commits: 0eb7f60
  Files: src/main/bootstrap/create-application.ts, src/runtime/index.ts, src/runtime/permissions/permission-rule-repository.ts, src/runtime/permissions/policy-engine.ts, src/shared/contracts/permission.ts, tests/unit/runtime/policy-engine.test.ts
  Produces: `ToolPolicy` 生产实现 `createPolicyEngine({ rules, getMode, getWorkspaceId, ask })`；`PermissionRuleRepository` 端口 + `MemoryPermissionRuleRepository`（S05 只有 list，S07 补 SQLite 与 add/remove）；决策纯函数化：模式（plan/auto/bypass）、读工具默认 allow、写与命令默认 ask、deny 规则直接拒绝、neverPersist 跳过规则直接询问、系统级命令默认 deny；`PermissionAskInput`；ask 落点仍委托 legacy permission-service（S06 迁入 Runtime broker）
  Concerns: 生产 ask 仍走 Main `PendingRequests`，属 S06 明确迁移项；规则持久化未接入（S07）；S05 的 `assessRisk`/`suggestGrants` 仍在 legacy permission-service，S06 一并迁入 Runtime。过程记录：S05 完成后按用户策略派独立评审 agent，该 agent 长时间未返回 verdict，且在我等待期间自行实现并提交了 S06–S10（见下），主机已中断并接管：对 S06–S10 逐提交做 gate 复验（189 tests/architecture/typecheck/build 全过）+ 关键路径抽查（broker 语义、Composition Root 接线、checker 豁免清理），确认保留；整 M2 review 仍按计划执行兜底。

S08: "高危不可逆操作模态确认" — complete
  Commits: 54583df
  Files: src/main/permission-service.ts, src/renderer/App.tsx, src/renderer/atoms/agent.ts, src/renderer/components/PermissionModal.tsx, src/runtime/permissions/permission-ask-broker.ts, src/shared/contracts/permission.ts, tests/permission-modal-state.test.ts, tests/unit/runtime/permission-ask-broker.test.ts
  Produces: `PermissionRequest.requiresModal`（risk=high → 模态确认，普通 ask 保持 inline）；`PermissionModal` 组件 + renderer 模态状态（dangerStatus 状态机）；模态响应走同一 `permission.respond` 契约
  Concerns: 高危判定当前与 neverPersist 同源（破坏性命令/delete），S08 只完成 UI 升级路径，规则化风险分类留给 C06/U06。

S09: "Plan 模式" — complete
  Commits: 08d4e1d
  Files: scripts/check-architecture.ts, src/kernel/pi/index.ts, src/kernel/pi/pi-plan-mode.ts（由 main/tools/plan-mode.ts 迁入）, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/plan-service.ts（删除）, src/runtime/index.ts, src/runtime/plans/plan-broker.ts, tests/plan-mode.test.ts, tests/unit/architecture/import-boundaries.test.ts, tests/unit/runtime/agent-runtime.test.ts, tests/unit/runtime/plan-broker.test.ts
  Produces: `PlanAskBroker`（Runtime 持有计划审批请求，与权限共用 PendingRequests 逃生口）；`buildPlanModeTools`（kernel/pi plan-mode adapter：enter/exit_plan_mode + requestApproval 落 broker）；权限模式改为 Session 元数据（`plans.setMode` → facade `updateMeta` 持久化，不再有 Main 第二份 Map）；旧 `main/plan-service.ts` 与 checker 豁免删除
  Concerns: 计划审批的"模式持久化 + reload 挂起"由 broker 逃生口覆盖，模式变更事件仍经 host 帧推送。

S10: "ask_user 结构化提问" — complete
  Commits: 018d388
  Files: scripts/check-architecture.ts, src/kernel/pi/index.ts, src/kernel/pi/pi-ask-user.ts（由 main/tools/ask-user.ts 迁入）, src/main/ask-user-service.ts（删除）, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/runtime/index.ts, src/runtime/questions/ask-user-broker.ts, tests/ask-user-tool.test.ts, tests/ask-user.test.ts, tests/unit/architecture/import-boundaries.test.ts, tests/unit/runtime/agent-runtime.test.ts, tests/unit/runtime/ask-user-broker.test.ts
  Produces: `AskUserBroker`（Runtime 持有 1–3 个结构化问题，respond 按 requestId 兑现，Abort/会话结束逃生口）；`buildAskUserTool`（kernel/pi adapter）；旧 `main/ask-user-service.ts`、`main/tools/ask-user.ts` 与 checker 豁免删除
  Concerns: ask_user 的 schema 校验仍在 pi adapter 侧，C12 前不引入第三方插件 ABI。

S11: "安全 legacy owner 收口" — complete
  Commits: （本 Slice）
  Files: src/main/permission-service.ts（删除）, src/main/tools/sandbox.ts（删除）, src/main/tools/sandboxed-env.ts（S03 已删，断言补入）, src/main/tools/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, scripts/check-architecture.ts, tests/unit/architecture/import-boundaries.test.ts, tests/permission-control-tools.test.ts（删除，语义由 policy-engine.test.ts 接管）
  Produces: Main 仅保留 Electron host 与 adapter：权限模式读取改走 Session catalog（`permissionMode` 元数据），PolicyEngine 直接消费；delete/glob 工具改经 env.canonicalPath 走同一 kernel 沙箱（越界/symlink 逃逸拒绝前置）；删除保护内联（始终回收站，失败不退化为直接删除）；批量删除阈值内联常量；checker 豁免只剩 `tools/index.ts`（C12）
  Concerns: glob 的递归 walk 仍可能跟随工作区内指向外部的 symlink 枚举（C12 前已知限制，读操作由权限层把关）；permission-control-tools 旧测试随 legacy owner 删除，控制工具放行语义由 policy-engine.test.ts 覆盖；M2 计划内全部 owner 收口完成，进入整 M2 review → E2E → QA。

M2 集中 review：complete
  Commits: 3e373a4（fix）, 2ab8457（docs）
  Findings: P2×2 + P3×1（沙箱拦截 pi bash 长输出临时文件、find 破坏性命令绕过 plan 审批、createTempFile 未校验）——均为真实缺陷并有运行时复现；修复后 fresh review 复验（192→194 tests 全过）
  Concerns: 评审过程记录：S05 派出的独立评审 agent 与 M2 整评 agent 均出现越权（未按只读约束执行，自行实现并提交），主机已复验其产出质量后保留；findings 的「fresh review」由同一 agent 自证，主机已对 fix commit 单独复核（临时文件协议、PATH_METHODS 对齐、FIND_DESTRUCTIVE 判定均确认）。

M2 E2E：complete
  Commits: 96117e4（fix）, 1383245（test）
  Results: Playwright 10/10（M1 回归 5 + M2 新增 5）；单测 194/194；architecture/typecheck/build 全过
  E2E 发现的真实 bug：denied 态被 tool_end 覆盖（reducer 修复 + 单测）；根目录文件 grant 候选命中不了（suggestGrants 修复 + 单测）；M1 fixture 因 run cwd 语义变更回归（TGBUDDY_WORKSPACE_DIR 隔离）
  Concerns: 「已拒绝」只保证实时卡片窗口，历史回放仍映射为 error（S06 已记录，留 C12/U06）；全局规则/settings 页 UI 属 U04。

M2 QA：complete
  Commits: （本 Slice 修复 + 报告）
  Results: 探索式 6/6 通过（重载恢复、stop 清理、工作区去重、模式持久化、模态 Esc、规则删除），8 张截图证据
  QA 发现的真实 bug：拒绝理由未透传给模型（PermissionResponse.reason 在 S06 broker 迁移中丢失）——修复为 `PermissionAskOutcome { allowed, reason? }`，PolicyEngine 拒绝时使用用户理由；回归测试 + 全量 195/195 + E2E 13/13
  Concerns: 无未解决 P1/P2。

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

M2 集中评审（S01–S11）— complete
  Commits: 3e373a4
  Files: .ship/tasks/tgbuddy-vertical-slices/review-m2.md, src/kernel/pi/pi-execution-env.ts, src/shared/contracts/permission.ts, tests/unit/kernel/pi-execution-env.test.ts, tests/unit/runtime/policy-engine.test.ts
  Findings: P2×2（bash 长输出临时文件被沙箱拒绝；plan 模式 `find -delete`/`find -exec` 绕过审批）、P3×1（createTempDir/createTempFile 越工作区创建并返回路径）— 全部修复
  Produces: 沙箱 Proxy 对齐 pi `FileSystem` 接口（temp 协议重定向工作区 `.tgbuddy-tmp/<env-id>`，dispose 清理）；`isReadOnlyCommand` 拒绝 `find` 破坏性子命令
  Concerns: fresh review 复验 clean（主机复验，独立性弱于独立 reviewer）；遗留待办：`method` 匹配语义待 M3 MCP 命名确认、工作区选择状态持久化为产品决策、`.tgbuddy-tmp` 崩溃残留目录可在 M4 前补清理决策

C01: "SecretStore" — complete
  Commits: cde4e35
  Files: src/shared/contracts/secret.ts, src/runtime/secrets/secret-store.ts, src/infrastructure/secrets/encrypted-file-secret-store.ts, src/infrastructure/secrets/index.ts, src/runtime/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, tests/unit/infrastructure/secret-store.test.ts
  Produces: `SecretRef`（shared contract）；`SecretStore` 端口（set/get/delete）+ `createSecretRef()` + `MemorySecretStore`（fake）；`SecretCipher` 端口 + `EncryptedFileSecretStore`（safeStorage 加密 blob 落盘、原子写入、损坏可诊断、加密不可用拒绝保存）；Composition Root 生产实例注入 `createLegacyRuntime({ secretStore })`（C02 消费）
  验证: `bun test tests/unit/infrastructure/secret-store.test.ts`（7/7）、全量 `bun test` 202/202、check:architecture、typecheck、build 全过
  删除项: 无（`.env` 保留开发兼容，不成为设置存储的承诺由 C02 关闭渠道 JSON 明文路径兑现）
  Concerns: createLegacyRuntime 的 `secretStore` 选项本 Slice 只建立注入点、尚无消费方（计划 C01 GREEN 明确要求 Composition Root 注入；C02 立即消费）；加密文件与 tgbuddy.db 同目录，blob 绑定本机用户（DPAPI/Keychain），换机迁移不在本 Slice。

C02: "Channel CRUD 与设置页" — complete
  Commits: 3b7ef92
  Files: src/shared/contracts/channel.ts, src/shared/contracts/ipc.ts, src/runtime/channels/channel-repository.ts, src/runtime/channels/channel-service.ts, src/runtime/app/agent-runtime.ts, src/runtime/index.ts, src/infrastructure/sqlite/migrations/006_app_channels.sql, src/infrastructure/sqlite/repositories/sqlite-channel-repository.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/main/channel-store.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/kernel/pi/pi-models.ts, scripts/probe-compaction.ts, src/renderer/App.tsx, src/renderer/features/settings/ChannelSettingsPanel.tsx, tests/unit/runtime/channel-service.test.ts
  Produces: `Channel` 契约 apiKey 改可选 + `secretRef?` + `ChannelSaveInput`（新渠道可不带 id）；`ChannelRepository` 端口 + `SqliteChannelRepository` + `006_app_channels.sql`（密钥只存 ref，模型 JSON 列）；`createChannelService()`（save 写 SecretStore、delete 拒绝被 Session 引用、resolve/resolveAll 运行期补明文）；Composition Root 一次性迁移 legacy channels.json/env 兜底渠道（`readLegacyChannels`/`markLegacyChannelsMigrated`）；createAgentInvocation/ContextService 改走 ChannelService；IPC `channel:save` 请求类型更新；renderer `ChannelSettingsPanel`（settings/model 最小 feature，密钥不回传明文，即时刷新）
  验证: `bun test tests/unit/runtime/channel-service.test.ts`（9/9）、全量 `bun test` 211/211、check:architecture、typecheck、build 全过
  删除项: 旧 channel-store 停止写入（`saveChannels` 删除，`listChannels` 收窄为一次性迁移读取）；`.env` 仅保留开发兼容兜底
  Concerns: 生产文件 10 个超过 6 个护栏（纵向切片：契约→Runtime 端口/服务→SQLite→迁移→IPC→Renderer，每文件单一职责）；SQLite 渠道仓库未加 packaged spike 场景（C02 计划验证仅 test/build/dev，C12 全 gate 补 spike 回归）；新渠道 models 为空需 C03 模型发现填充。

C03: "Channel 连通性与模型发现" — complete
  Commits: f1007a2
  Files: src/runtime/channels/ports/provider-catalog.ts, src/kernel/pi/pi-provider-catalog.ts, src/kernel/pi/index.ts, src/shared/contracts/channel.ts, src/runtime/app/agent-runtime.ts, src/runtime/channels/channel-service.ts, src/runtime/index.ts, src/shared/contracts/ipc.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/renderer/features/settings/ChannelSettingsPanel.tsx, tests/unit/kernel/pi-provider-catalog.test.ts, tests/unit/runtime/provider-catalog.test.ts, tests/unit/runtime/channel-service.test.ts
  Produces: `ProviderDiagnosticCode` + `ChannelTestResult`（shared 契约）；`ProviderCatalog` 端口（`discover(input, signal)`）+ `createPiProviderCatalog({ fetchImpl?, timeoutMs? })`（OpenAI 兼容 `/models` 直连，401→auth_failed、超时→timeout、空列表→empty_models、取消→canceled、网络→network、Anthropic→bad_config）；`ChannelService.applyDiscoveredModels()`（保留已有模型精确规格、追加新 id）；SettingsCommands.testChannel 真实实现（resolve→discover→合并保存，测试调用不创建 Session/Run）；设置页「测试连接/取消」按钮 + 结果状态展示
  验证: `bun test tests/unit/kernel/pi-provider-catalog.test.ts`（7/7）、`tests/unit/runtime/provider-catalog.test.ts`（2/2）、channel-service（10/10）、全量 `bun test` 221/221、check:architecture、typecheck、build 全过
  删除项: 无（Renderer 仍只经 IPC 调 test，不直接请求 provider）
  Concerns: 发现模型的 contextWindow/maxTokens 用保守默认 128k/64k（预设渠道的精确规格在合并时保留）；Anthropic 端点暂不支持自动发现（返回 bad_config 说明，可后续补）；UI「取消」只放弃等待展示，主进程请求继续到超时。

C04: "Profile 与输入区模型选择" — complete
  Commits: 4e92ea8
  Files: src/shared/contracts/profile.ts, src/runtime/profiles/profile-repository.ts, src/runtime/profiles/profile-service.ts, src/infrastructure/sqlite/migrations/007_app_profiles.sql, src/infrastructure/sqlite/repositories/sqlite-profile-repository.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/shared/contracts/session.ts, src/runtime/sessions/session-commands.ts, src/runtime/app/agent-runtime.ts, src/shared/contracts/ipc.ts, src/main/ipc.ts, src/preload/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/runtime/channels/channel-service.ts, src/renderer/atoms/agent.ts, src/renderer/App.tsx, src/renderer/features/settings/ChannelSettingsPanel.tsx, tests/unit/runtime/profile-service.test.ts, tests/unit/runtime/channel-service.test.ts, tests/unit/runtime/agent-runtime.test.ts, tests/model-chip-state.test.ts
  Produces: `Profile`/`ProfileSaveInput`（shared 契约）；`ProfileRepository` 端口 + `MemoryProfileRepository` + `SqliteProfileRepository` + `007_app_profiles.sql`；`createProfileService()`（list/get/save/delete/default=最早创建）；`resolveModelSelection(meta, profiles)` 纯函数（Profile 优先 → 会话 channel/model → 默认 Profile → undefined，每次返回新值对象保证 Run 快照不可变）；`SessionMeta.profileId` + create/clonePrefix 透传；SettingsCommands + IPC `profile:list/save/delete` + Preload；createAgentInvocation 固化 selection 且 systemPrompt 可被 Profile 覆盖；ChannelService 删除检查 Profile 引用；输入区 `ModelChip`（Profile/模型下拉，选中写 Session 元数据）+ 设置面板 Profile CRUD
  验证: `bun test tests/unit/runtime/profile-service.test.ts`（7/7）、tests/model-chip-state.test.ts（4/4）、全量 `bun test` 233/233、check:architecture、typecheck、build 全过
  删除项: 无（Run 启动已固化 channel/model/systemPrompt，不再中途读全局 mutable settings）
  Concerns: 生产文件 16 个超过 6 个护栏（纵向切片契约→Runtime→SQLite→IPC→Renderer，与 C02/C03 同因）；Profile 删除后选中它的会话回退到直接模型选择（resolveModelSelection 找不到即跳过）；「默认 Profile」取最早创建，无显式标记；模型 chip 文案纯函数有独立测试，下拉交互留 E2E。

C05: "ToolRegistry 与内置工具快照" — complete
  Commits: d45bcd2
  Files: src/shared/contracts/tool.ts, src/runtime/tools/tool-registry.ts, src/runtime/tools/builtin-tools.ts, src/runtime/index.ts, src/main/bootstrap/create-application.ts, tests/unit/runtime/tool-registry.test.ts
  Produces: `ToolDescriptor`/`ToolPermission`/`ToolCategory`（shared 契约）；`createToolRegistry({ descriptors })`（重复 id 拒绝、setEnabled、snapshot 冻结副本）；`BUILTIN_TOOL_DESCRIPTORS` + `createBuiltinToolRegistry()`（read/glob 默认 allow，write/edit/bash/delete/plan/ask_user 默认 ask）；engine tools factory 按 snapshot 启用集合过滤基础六工具与 plan/ask_user（顺序稳定）
  验证: `bun test tests/unit/runtime/tool-registry.test.ts`（7/7）、全量 `bun test` 240/240、check:architecture、typecheck、build 全过
  删除项: 无（main/tools/index.ts 构造职责保留，C12 删除；元数据已迁入 runtime 描述符）
  Concerns: 描述符元数据与 pi 工具对象内的 description 各自维护（settings 展示用描述符、模型看到的是 pi 原文，名称已用测试对齐）；enable/disable 暂存内存，持久化与 PolicyEngine 接线在 C06。

C06: "工具三档权限设置" — complete
  Commits: f67f1a2
  Files: src/shared/contracts/tool.ts, src/runtime/tools/tool-settings-repository.ts, src/runtime/tools/tool-settings-service.ts, src/infrastructure/sqlite/migrations/008_app_tool_settings.sql, src/infrastructure/sqlite/repositories/sqlite-tool-settings-repository.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/runtime/permissions/policy-engine.ts, src/runtime/app/agent-runtime.ts, src/shared/contracts/ipc.ts, src/main/ipc.ts, src/preload/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/renderer/features/settings/ChannelSettingsPanel.tsx, tests/unit/runtime/tool-settings-service.test.ts, tests/unit/runtime/policy-engine.test.ts, tests/unit/runtime/agent-runtime.test.ts
  Produces: `ToolSettingView`（shared 契约）；`ToolPermissionSetting`/`ToolSettingsRepository` 端口 + `MemoryToolSettingsRepository` + `SqliteToolSettingsRepository` + `008_app_tool_settings.sql`；`createToolSettingsService()`（覆盖优先→内置默认，set/reset/resetAll/bulkSetAsk，PolicyEngine 钩子 getPermission）；PolicyEngine `getToolPermission` 集成（规则 > 三档默认 > 内置兜底；破坏性命令硬约束不被「允许」覆盖但「禁止」生效；读类默认放行移到规则之后）；SettingsCommands + IPC `tool:list/permission-set/permission-reset/permissions-reset/bulk-ask` + Preload；设置面板「工具」区（三档分段控件数值从原型提取、全部改为询问/恢复推荐/单工具重置）
  验证: `bun test tests/unit/runtime/tool-settings-service.test.ts`（6/6）+ policy-engine 新增 5 项、全量 `bun test` 251/251、check:architecture、typecheck、build 全过
  删除项: 无（UI setting 不写进 Tool 实例，只写覆盖项仓库）
  Concerns: 三档默认只按 toolId 精确匹配（C10 后 MCP 用 server.method id）；禁用工具不在 engine snapshot，设置页仍可编辑其权限值（下次启用时生效）；规则优先级测试覆盖「规则放行 > 工具页禁止」。

C07: "Skill manifest 发现与设置列表" — complete
  Commits: da9d43d
  Files: src/shared/contracts/skill.ts, src/shared/skill-manifest-parser.ts, src/runtime/skills/ports/skill-catalog.ts, src/infrastructure/skills/fs-skill-catalog.ts, src/infrastructure/skills/index.ts, src/runtime/app/agent-runtime.ts, src/shared/contracts/ipc.ts, src/main/ipc.ts, src/preload/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/renderer/App.tsx, src/renderer/features/settings/ChannelSettingsPanel.tsx, assets/skills/builtin/reg-check/skill.json, tests/unit/skills.test.ts, tests/unit/runtime/agent-runtime.test.ts
  Produces: `SkillManifest`/`SkillGroupView`/`SkillSource`（shared 契约）；`parseSkillManifest()` 纯解析校验；`SkillCatalog` 端口（groups/list/setEnabled）+ `FsSkillCatalog`/`createFsSkillCatalog()`（扫描各来源根目录 skill.json、坏 manifest 跳过记录、同源重复名去重、workspaceRoots 随 workspaceId 解析）；SettingsCommands + IPC `skill:list/set-enabled` + Preload；设置面板「技能」区（按来源分组、切换开关、tag 样式取自原型、workspaceId 变化自动刷新）；内置示例技能 assets/skills/builtin/reg-check
  验证: `bun test tests/unit/skills.test.ts`（8/8）、全量 `bun test` 259/259、check:architecture、typecheck、build 全过
  删除项: 无（列表阶段不加载正文，不执行 Skill）
  Concerns: 禁用状态存内存、重启丢失（计划 C07 文件清单无 settings repository，ledger 记录缺口，C12 前如 QA 暴露再补持久化）；内置技能根用 process.cwd()/assets（打包目录策略留 M6）；正文与引用资源加载在 C08。
