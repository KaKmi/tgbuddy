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

C08: "Skill 正文按调用加载" — complete
  Commits: 0140375
  Files: src/runtime/skills/ports/skill-loader.ts, src/infrastructure/skills/fs-skill-loader.ts, src/infrastructure/skills/index.ts, src/kernel/pi/pi-skill-tool.ts, src/kernel/pi/index.ts, src/runtime/runs/agent-engine.ts, src/runtime/tools/builtin-tools.ts, src/runtime/permissions/policy-engine.ts, src/main/bootstrap/create-legacy-runtime.ts, src/main/bootstrap/create-application.ts, src/runtime/index.ts, tests/unit/infrastructure/skill-loader.test.ts, tests/unit/kernel/pi-skill-tool.test.ts
  Produces: `LoadedSkillContent`/`SkillLoader` 端口（loadBody/loadResource + token 估算）；`FsSkillLoader`/`createFsSkillLoader()`（正文读 SKILL.md、资源经 root 包含性校验，`..`/绝对路径拒绝、缺失可诊断）；`buildSkillTool({ skills, loader })`（pi `skill` 工具：按名称/正文/相对资源加载，构造时冻结技能清单）；`AgentInvocation.skills`（Run 启动冻结启用技能摘要）；systemPrompt 追加技能清单（名称/标题/描述/触发词）；内置描述符新增 `skill`（默认 allow，plan 模式按只读放行）
  验证: `bun test tests/unit/infrastructure/skill-loader.test.ts`（4/4）+ pi-skill-tool（4/4）、全量 `bun test` 267/267、check:architecture、typecheck、build 全过
  删除项: 无（Skill 内容不常驻全局 prompt，无第三方插件 ABI）
  Concerns: token 估算为 4 字符/token 的粗略值（仅记账/用量提示，C12 精确分类记账）；skill 工具读取资源未走 per-run 沙箱（技能 root 已是工作区/数据目录内边界，越界引用由 loader 拒绝）；正文文件在运行中修改会影响当次加载（清单冻结、内容按需读取，符合原型「判断需要时才读进来」）。

C09: "MCP 配置、连接与状态卡" — complete
  Commits: 6f91e63
  Files: src/shared/contracts/mcp.ts, src/runtime/mcp/mcp-config-repository.ts, src/runtime/mcp/ports/mcp-transport.ts, src/runtime/mcp/mcp-manager.ts, src/infrastructure/mcp/sdk-mcp-transport.ts, src/infrastructure/mcp/index.ts, src/infrastructure/sqlite/migrations/009_app_mcp_servers.sql, src/infrastructure/sqlite/repositories/sqlite-mcp-config-repository.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/runtime/app/agent-runtime.ts, src/shared/contracts/ipc.ts, src/main/ipc.ts, src/preload/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/renderer/features/settings/ChannelSettingsPanel.tsx, scripts/mcp-fixture-server.mjs, package.json, bun.lock, tests/unit/runtime/mcp-manager.test.ts, tests/unit/runtime/agent-runtime.test.ts
  Produces: `McpServerConfig`/`McpSaveInput`/`McpServerStatus`（shared 契约）；`McpConfigRepository` 端口 + Memory + `SqliteMcpConfigRepository` + `009_app_mcp_servers.sql`；`McpTransport`/`McpTransportFactory` 端口 + `SdkMcpTransportFactory`（@modelcontextprotocol/sdk：stdio 子进程 / http SSE，connect 完成 initialize 握手）；`createMcpManager()`（连接状态 off/connecting/connected/error、超时 15s、环境变量 `secret:<ref>` 替换、禁用拒绝连接、断开/重连、配置变更断开旧连接）；SettingsCommands + IPC `mcp:list/save/delete/connect/disconnect/status` + Preload；设置面板连接器卡片（状态点/连接/断开/重连/错误展示，样式取自原型 connectors）；scripts/mcp-fixture-server.mjs（最小 stdio MCP echo 服务）
  验证: `bun test tests/unit/runtime/mcp-manager.test.ts`（7/7）、全量 `bun test` 274/274、check:architecture、typecheck、build 全过；SDK↔fixture server 冒烟（connect/listTools/callTool echo 成功）
  删除项: 无（此 Slice 不把 MCP tool 注入 Run；C10 才接工具发现）
  Concerns: 依赖新增 @modelcontextprotocol/sdk@1.30.0（打包需进 node_modules，M6 收口）；save 同步断开旧连接（fire-and-forget）；http 用 SSE transport，新版 streamable http 留后续；env 的 secret 引用由用户手填 ref（设置页未提供密钥选择器）。

C10: "MCP tool 发现与能力快照" — complete
  Commits: 363b3bd
  Files: src/shared/contracts/mcp.ts, src/runtime/mcp/ports/mcp-transport.ts, src/runtime/mcp/mcp-manager.ts, src/runtime/tools/tool-registry.ts, src/infrastructure/mcp/sdk-mcp-transport.ts, src/infrastructure/sqlite/migrations/010_app_mcp_servers_key.sql, src/infrastructure/sqlite/repositories/sqlite-mcp-config-repository.ts, src/infrastructure/sqlite/app-database.ts, src/main/bootstrap/create-application.ts, src/renderer/features/settings/ChannelSettingsPanel.tsx, tests/unit/runtime/mcp-manager.test.ts
  Produces: `McpServerConfig.key`（工具名前缀，save 缺省按名称 slug）；`McpToolDefinition` + `McpTransport.listTools()`（SDK tools/list 映射）；`ToolRegistry.register/unregister`（重复 id 拒绝、注销只影响下一 Run 快照）；McpManager 连接成功后 `server.method` 描述符进注册表（读类方法默认 allow、其余 ask；先校验跨服务重名冲突再注册；重连 schema 变化先注销旧清单）、断开/删除/配置变更注销工具；设置页连接器卡片可展开工具列表 + 三档权限（复用 tool:permission-set）；迁移 010 加 key 列
  验证: `bun test tests/unit/runtime/mcp-manager.test.ts`（11/11）、全量 `bun test` 278/278、check:architecture、typecheck、build 全过
  删除项: 无（此 Slice 不执行 MCP tool，调用在 C11）
  Concerns: MCP 工具权限默认按方法名前缀启发式（get/list/search/read/fetch/query→allow），用户可在设置覆盖；key 变更后旧工具 id 失效，属预期（重连后刷新）；当前 Run 快照在连接建立前冻结，连接期间注册不影响已运行 Run。

C11: "MCP tool 权限与调用" — complete
  Commits: 1f092ab
  Files: src/shared/contracts/tool.ts, src/runtime/mcp/ports/mcp-transport.ts, src/runtime/mcp/mcp-manager.ts, src/runtime/permissions/policy-engine.ts, src/runtime/index.ts, src/kernel/pi/pi-mcp-tool.ts, src/kernel/pi/index.ts, src/infrastructure/mcp/sdk-mcp-transport.ts, src/main/bootstrap/create-application.ts, tests/unit/runtime/mcp-manager.test.ts, tests/unit/kernel/pi-mcp-tool.test.ts
  Produces: `ToolDescriptor.owner/inputSchema`；`McpCallResult` + `McpTransport.call()`（SDK callTool + CallToolResultSchema，isError 结构化错误转 throw）；`McpManager.call()`（未连接/断线抛「请先连接」、超时/取消映射、成功返回文本）；`isReadLikeMcpMethod()`（与默认权限启发式同源）；PolicyEngine plan 模式放行读类 server.method（替换旧 mcp__ 前缀约定）；`buildMcpTool()`（pi `server.method` 工具，宽松 Record 参数、透传 signal）；engine tools factory 从 snapshot 注入 MCP 工具（只使用当前 Run 冻结快照，断线调用失败显示真实工具卡错误）
  验证: `bun test tests/unit/runtime/mcp-manager.test.ts`（15/15）+ pi-mcp-tool（3/3）、全量 `bun test` 285/285、check:architecture、typecheck、build 全过；SDK callTool 冒烟（echo 调用 isError=false 内容正确）
  删除项: 无（长输出暂留普通预览，A04 再 Blob 化）
  Concerns: MCP 工具参数用宽松 Record，精确 JSON Schema 校验由服务端执行（inputSchema 已存入 descriptor，后续可精确化）；plan 模式读类 MCP 判定基于方法名前缀（用户把写方法改成 allow 也不会在 plan 模式放行，写方法仍被拒）。

C12: "CapabilitySnapshot 与 token 账本" — complete
  Commits: d7a6713
  Files: src/shared/contracts/run-snapshot.ts, src/runtime/runs/run-snapshot.ts, src/runtime/runs/run-repository.ts, src/runtime/runs/run-coordinator.ts, src/runtime/runs/agent-engine.ts, src/runtime/app/agent-runtime.ts, src/shared/contracts/ipc.ts, src/main/ipc.ts, src/preload/index.ts, src/infrastructure/sqlite/migrations/011_app_runs.sql, src/infrastructure/sqlite/repositories/sqlite-run-repository.ts, src/infrastructure/sqlite/app-database.ts, src/infrastructure/sqlite/index.ts, src/main/bootstrap/create-application.ts, src/main/bootstrap/create-legacy-runtime.ts, src/renderer/App.tsx, src/renderer/components/ContextUsagePanel.tsx, src/kernel/pi/pi-builtin-tools.ts（由 main/tools/index.ts 迁入，删除旧文件）, src/main/data-dir.ts + src/main/legacy-channels.ts（由 channel-store.ts 拆出，删除旧文件）, src/main/index.ts, scripts/probe-compaction.ts, scripts/check-architecture.ts（移除 LEGACY_COMPATIBILITY 豁免）, scripts/sqlite-spike-scenarios.ts（app-database 断言扩到 001–011 与全部 app_* 表）, tests/unit/runtime/run-snapshot.test.ts, tests/integration/run-coordinator.test.ts, tests/unit/architecture/import-boundaries.test.ts, .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md
  Produces: `CapabilitySnapshot`/`RunRecord`/`RunUsageLedger` 等（shared 契约）；`buildCapabilitySnapshot()`（Profile/模型/工具/Skill/MCP 全部从冻结 invocation 构建，敏感配置只存 ref/名称）+ `mergeUsageLedger()`（分类 token/cost 逐轮相加，失败 Run 也有归零账本）；`RunRepository` 端口 + Memory + `SqliteRunRepository` + `011_app_runs.sql`；RunCoordinator 在启动建记录、settled 一次提交状态/账本/错误；`AgentInvocation.tools/profile`；`AgentRuntime.runs.list` + IPC `runs:list` + Preload；ContextUsagePanel 展示最近一次运行账本；**删除 Main 遗留 owner**：`src/main/tools/index.ts` 迁入 kernel/pi（回收站经 `trashItem` 端口注入 shell.trashItem）、`src/main/channel-store.ts` 拆为 data-dir + legacy-channels、checker 豁免清零
  验证: `bun test` 291/291、check:architecture、typecheck、build 全过；`bun run spike:sqlite` 全场景通过（app-database 断言 001–011 + 9 张 app_* 表）；`bun run probe` 真实模型通过
  删除项: `src/main/tools/index.ts`、`src/main/channel-store.ts`、checker LEGACY_COMPATIBILITY（C12 完成，无豁免残留）
  Concerns: Run 记录无独立清理策略（会话删除时 run 账本随行保留，M4 可与 blob 引用清理一并决策）；run 持久化在 coordinator 可选注入（旧测试不传则跳过，生产已接 SQLite）；UI 账本只展示最近一次 settled run（历史账本可经 runs:list 扩展）。

M3 开发阶段（C01–C12）— complete
  Commits: cde4e35 … d7a6713（每 Slice 独立 feat commit + docs commit）
  Results: 全量 `bun test` 291/291；check:architecture / typecheck / build 全过；`bun run spike:sqlite` 全场景通过；`bun run probe` 真实模型通过
  下一步: M3 集中 review（$ship:review）→ 修复 → fresh review → E2E → QA → 里程碑收尾

M3 集中 review — complete
  Commits: 11dba73
  Findings: P1×1（`runs:list` IPC 恒空：RunCoordinator 缺 list()）、P2×3（plan 模式读类 MCP 误拒、app_runs UNIQUE 同毫秒故障面、MCP 并发 connect 双连接）、P3×6（connect 失败旧工具未注销、SecretStore 写失败不一致与 secrets:null 格式洞、Windows 路径大小写误拒、MCP 无 dispose 残留子进程、工具工厂未用冻结快照、技能目录读取竞态）— 全部修复，fresh 复核 clean（review-m3.md）
  验证: `bun test` 296/296、architecture、typecheck、build 全过

M3 E2E — complete
  Commits: 167f39a（fix）、c39af96（test）、b55de89（report）
  Results: Playwright Electron 20/20（M1 回归 5 + M2 回归 8 + M3 新增 7）；单测 297/297
  E2E 发现的真实缺陷（已修复）：MCP 新建表单哨兵 bug、mcp-key-input 误放渠道表单、MCP 连接后工具列表不刷新、账本先于 run_end 落盘（避免 UI 读到 running 记录）、单条密钥解密失败拖垮启动（safeStorage 硬杀环境）与 legacy 迁移容错
  Concerns: M2「总是允许」跨重启用例由硬杀改优雅重启——E2E 硬杀（child.kill）会让 Electron safeStorage 的 DPAPI blob 无法被新实例解密（渠道密钥只存 ref 后的安全架构 + 环境组合），规则持久化验证不变，崩溃恢复由 run-recovery 单测与 m1 E2E 覆盖；已做应用级韧性（单条失败只影响该 ref、启动不阻塞）

M3 QA — complete
  Commits: 6d7ca08（fix）、ed2b34c（driver/report/screenshots）
  Results: 探索式 13/13 通过（无 key 渠道、改名保留状态、删除被引用拒绝可见、模型 chip、工具单覆盖/恢复、工作区技能、技能开关、MCP 坏命令诊断/发现/断开移除、Run 账本、重启持久化）
  QA 发现的真实缺陷（已修复）：删除渠道被拒错误只在表单内渲染（用户不可见）→ 设置页全局错误横幅；MCP 断开后工具列表未刷新 → disconnect 后 refresh

M3 里程碑收尾 — complete
  Commits: （本阶段文档提交）
  Results: docs/08-项目进度.md 标记 M3 完成并指向 M4 A01；AGENTS.md 删除表 C12 两项标记已删除（channel-store 拆为 data-dir + legacy-channels、tools/index 迁入 kernel/pi + 注入回收站端口）；README 状态行更新
  Concerns: 无未解决 P1/P2

M2+M3 联合 QA（用户要求，可重复执行）— complete
  Commits: 77cf183（fix）、8c2a0e5（docs）
  Results: `.ship/tasks/tgbuddy-vertical-slices/qa/m2m3-qa-driver.mjs` 27/27 通过（冒烟 5 + M2 7 + M3 12 + 重启持久化/双会话 2 + 工具/技能/渠道/Profile/MCP 边界），截图 21 张
  QA 发现的真实缺陷（已修复 + 回归）：
  - P1：`SessionMeta.profileId` 从未落库——C04 只加契约与内存仓库，`app_sessions` 表与 SqliteSessionRepository 无对应列/映射，Profile 选择在真实运行中静默失效；修复为迁移 012 + repository 全映射（NOT NULL 列写空串）+ 静态 SQL 一致性测试（列/占位符/值三者锁死，防再次错位）
  - P2：设置页创建 Profile 后输入区模型 chip 不刷新（profilesAtom 仅挂载时加载）；修复为 ModelChip 打开菜单时刷新渠道/Profile
  Concerns: 全量回归 301/301、E2E 20/20、architecture/typecheck/build 全过；脚本用 Enter 提交与 IPC 驱动输入侧（规避 popover 遮罩竞态），用户可见结果断言保留

M3 后续用户手动 QA（ask_user 卡片）— complete
  Commits: 4cbc9d7（fix）、（docs）
  Results: 用户手动测试发现 ask_user「选了选项却无法提交」，必须去「其他答案」输入框打字才能提交
  QA 发现的真实缺陷（已修复 + 回归）：
  - P1：AskUserCard 选中选项时会把 `custom[id]` 清成空串，提交判定 `custom[id] ?? answers[id]` 不会把空串回退到选项答案，导致按钮一直禁用；修复为提取纯函数 `resolveAskUserAnswer`/`isAskUserComplete`（空串视为「未自定义」再回退选项），提交值同步走同一函数
  Concerns: 全量单测 307/307（新增 3 项）、E2E 20/20（ask_user 用例改为第一题点选选项回归）、architecture/typecheck/build 全过

权限模型收口（用户方向：工具权限只读 + 计划模式 skill 化 + 审批 Codex 化）— complete
  Commits: c531488（feat）、（docs）
  Results: 对照 Proma（permissionMode + SAFE_TOOLS 分类 + 会话白名单，无 per-tool 三档）与 pi
  （beforeToolCall/tool_call block 拦截 + setTools/setActiveTools 动态工具集），把 TgBuddy 权限收敛为
  「权限模式（默认/计划/完全访问）+ 总是允许规则 + 内置分类兜底」三层
  变更：
  - 删除 per-tool 三档设置链路：tool-settings repository/service、SqliteToolSettingsRepository、
    迁移 008（旧库残留孤儿表无害）、IPC/Preload 四个写接口；工具页只读展示内置分类默认徽标
  - PolicyEngine 去掉 getToolPermission 依赖：决策只剩 模式 → 规则 → 内置分类 → neverPersist 硬约束
  - 计划模式 skill 化：新增内置技能 `plan-mode`（assets/skills/builtin/plan-mode/SKILL.md，中文完整
    工作流：调研规则/计划结构/提交审批/修订）；移除 enter_plan_mode 工具，exit_plan_mode 收缩为宿主
    只读能力始终注入（同 skill 工具不进工具区）；模式 chip 手动切换（Codex 显式模态）
  - 审批卡 Codex 化：TL;DR 摘要 + 展开完整计划 + 拒绝意见输入
  - QA 驱动与 E2E 同步：C06 用例改为「工具只读展示 + 完全访问放行 + 默认权限询问」；
    计划闭环用例改为 chip 进入 + 提交计划 + 审批；m2-permission 重启用例修复 strict-mode 竞态（.last()）
  Concerns: 全量单测 297/297、E2E 20/20、architecture/typecheck/build 全过；per-tool「禁止」能力
  随三档一并移除，需要精确拒绝时用 deny 规则（工具×路径/前缀/方法）；迁移 008 移除后旧库的表保留，
  不主动删用户数据

A01 "内容寻址 BlobStore" — complete
  Commits: （本 Slice）
  Files: src/runtime/blob/blob-store.ts、src/infrastructure/blob/node-fs-blob-store.ts、
    src/infrastructure/blob/index.ts、src/runtime/index.ts、tests/unit/infrastructure/blob-store.test.ts、
    .ship/tasks/tgbuddy-vertical-slices/plan/m4-m5-arch-design.md
  Produces: `BlobStore` 端口（put/get/has/delete）、`BlobRef{hash,size,mime}`、
    `NodeFsBlobStore`（sha256 内容寻址、原子写 temp+rename、读回全量校验）
  RED/GREEN: 6 项测试覆盖 put/dedupe/hash mismatch/atomic/missing/delete 幂等/mime
  Concerns: 端口层不承担 hash 计算（内容寻址必须 sha256 防碰撞，属于基础设施职责）；
    get 全量重算 sha256，大 Blob 读回成本高，A04 长输出按需读取时再评估增量校验；
    M4 架构设计（m4-m5-arch-design.md）已记录「能用 pi 就用 pi」原则与 A04/A05 精化

A02 "附件选择、预览与持久化" — complete
  Commits: （本 Slice）
  Files: src/shared/contracts/attachment.ts、blob.ts、src/runtime/attachments/attachment-repository.ts、
    src/infrastructure/sqlite/migrations/013_app_attachments.sql、sqlite-attachment-repository.ts、
    src/runtime/sessions/session-message-history.ts、src/kernel/pi/pi-agent-engine.ts、
    src/main/ipc.ts、src/main/bootstrap/create-application.ts、create-legacy-runtime.ts、
    src/preload/index.ts、src/renderer/App.tsx、src/renderer/components/AttachmentChips.tsx、
    tests/unit/runtime/attachment-repository.test.ts
  Produces: `AttachmentRef`（name/size/mime/blob）、`AttachmentRepository`（save/byMessage/deleteSession）、
    IPC `attachment:stage/discard`、`StartRunInput.attachments`、pi-engine `persistAttachments` 钩子、
    KernelMessage.attachments 历史回放、输入区附件 chips（📎 选择 → stage → 发送/移除）
  RED/GREEN: 附件仓库 3 项（幂等覆盖/会话隔离）+ BlobStore 6 项；architecture/typecheck/build 全过
  Concerns: 附件 ref 走 app_attachments 按 (sessionId, entryId) 挂消息，不改 pi 消息本体（信封零翻译）；
    stage 失败只记诊断（A09 兜底孤儿）；取消未发送草稿即 discard 删 blob；
    此 Slice 不做模型 multimodal 转换（A03 用 pi 原生 prompt(text,{images})）

A03 "附件进入模型上下文" — complete
  Commits: （本 Slice）
  Files: src/kernel/pi/pi-attachment-content.ts、src/kernel/pi/pi-agent-engine.ts、
    src/main/bootstrap/create-application.ts、tests/unit/kernel/pi-attachment-content.test.ts
  Produces: `preparePromptWithAttachments`（图片→pi ImageContent base64、文本→[附件]块、
    截断/诊断/模型能力校验）、engine `loadAttachment` 端口（Composition Root 注入 BlobStore.get）
  RED/GREEN: 6 项（图片/文本/模型不支持/读取失败/超长截断/无附件短路）
  Concerns: 图片经 pi 原生 prompt(text,{images}) 注入，pi session 会存 base64 副本；
    原始 ref 仍在 app_attachments（UI/审计用），与「消息只存 ref」在契约层保持一致；
    超长文本附件截断到 64KB，完整内容在 BlobStore（A04 结果区打开）

A04 "长工具输出 Blob 化" — complete
  Commits: （本 Slice）
  Files: src/kernel/pi/pi-tool-output.ts、src/kernel/pi/pi-agent-engine.ts、
    src/shared/contracts/message.ts（ToolDetails.outputRef）、src/shared/contracts/ipc.ts、
    src/main/ipc.ts、src/main/bootstrap/create-application.ts、src/preload/index.ts、
    src/renderer/App.tsx（buildToolResultMap 带 outputRef）、src/renderer/components/ToolCard.tsx、
    tests/unit/kernel/pi-tool-output.test.ts
  Produces: `TOOL_OUTPUT_THRESHOLD=256KB`（按 UTF-8 字节）、`prepareToolOutputPreview`
    （pi truncateTail 8 行尾部预览 + 截断说明 + outputRef）、engine `tool_result` 补丁
    （ToolResultPatch 替换内容/合并 details）、IPC `tool-output:read`、ToolCard「查看完整输出」展开
  RED/GREEN: 5 项（阈值上下/尾部 8 行/store 失败降级/UTF-8 多字节/多文本块合并）
  Concerns: 阈值按字节算（中文 3 字节/字不会被低估）；store 失败降级为纯截断不阻断 Run；
    禁止依赖 pi 原生 details 形状——details 由我们在补丁里按 ToolDetails 契约写入；
    probe 未跑（需真实渠道），E2E 里程碑统一覆盖

A05 "Artifact 投影" — complete
  Commits: （本 Slice）
  Files: src/shared/contracts/artifact.ts（ArtifactRef 恢复+扩展）、
    src/runtime/artifacts/artifact-projector.ts、artifact-repository.ts、
    src/infrastructure/sqlite/migrations/014_app_artifacts.sql、sqlite-artifact-repository.ts、
    src/kernel/pi/pi-agent-engine.ts（projectArtifact 钩子）、
    src/main/bootstrap/create-application.ts、create-legacy-runtime.ts（artifacts.list 接仓库）、
    src/runtime/sessions/session-message-history.ts（删除旧 countArtifacts 推导）、
    tests/unit/runtime/artifact-projector.test.ts
  Produces: `ArtifactRef`（kind=file/image/document/tool-output、path/blob、sourceSkill）、
    `projectArtifact` 纯函数（write/edit 成功 + 路径参数 → 产物，不读 pi details）、
    `ArtifactRepository`（同 sessionId+path upsert）、engine 成功结果钩子、IPC artifacts.list 数据源
  RED/GREEN: 7 项（write/edit 投影/read/delete/bash 不投影/失败不投影/图片文档归类/
    无路径/别名路径键/sourceSkill + 仓库同路径覆盖与会话隔离）
  Concerns: 恢复被误覆盖的既有 ArtifactRef 契约，并演进 blobId:string → blob:BlobRef
    （对齐 A01 BlobStore，`blobId` 无其它引用）；producerRunId 留 D01 lineage 精确填充；
    artifacts.list 已接真实仓库，A06 结果区直接消费；旧 countArtifacts 推导及其测试一并删除

A06 "结果列表、分组与筛选" — complete
  Commits: （本 Slice）
  Files: src/renderer/features/results/ResultsPanel.tsx、results-view.ts、
    src/renderer/App.tsx（结果占位替换）、src/shared/contracts/ipc.ts、src/preload/index.ts、
    src/main/ipc.ts（artifact:list）、tests/results-view-state.test.ts
  Produces: IPC `artifact:list`、ResultsPanel（时间倒序、本次任务/更早按最近 Run 边界分组、
    全部/文件/图片/文档/输出筛选、选中态）、纯视图模型 groupArtifacts/filterArtifacts
  RED/GREEN: 4 项状态测试（倒序+分组边界/无边界/空列表/类型筛选）
  Concerns: 「本次任务」边界 = 最近一次 Run 的 createdAt；选中态留 A07 预览消费；
    结果区沿用 hidden xl:flex 布局（窄屏不占位）

A07 "Artifact 只读预览与外部打开" — complete
  Commits: （本 Slice）
  Files: src/main/artifact-io.ts、src/main/artifact-path.ts、src/shared/contracts/artifact.ts
    （ArtifactPreviewResult）、src/shared/contracts/ipc.ts、src/main/ipc.ts、
    src/main/bootstrap/create-application.ts、src/preload/index.ts、
    src/renderer/features/results/ResultsPanel.tsx（预览区+打开按钮）、
    tests/unit/runtime/artifact-path.test.ts
  Produces: `resolveArtifactInsideMount`（纯字符串路径逃逸，无 node 依赖）、
    `createArtifactIo`（mount 归一化 + realpath 双防线、文本预览 256KB 截断、二进制识别、
    shell.openPath 外部打开）、IPC artifact:preview/open、ResultsPanel 只读预览区
  RED/GREEN: 4 项路径逃逸测试（相对拼接/mount 内绝对/..逃逸/跨盘绝对）
  Concerns: 纯字符串路径函数放 Main 层（runtime 不得依赖 node:path）；
    二进制用 NUL 字节启发式 + mime image 走外部打开；预览只读，改动回对话（A08）

A08 "「让 Agent 改这份」入口" — complete
  Commits: （本 Slice）
  Files: src/renderer/features/results/edit-draft.ts、ResultsPanel.tsx（编辑请求按钮）、
    src/renderer/App.tsx（草稿注入 + 会话切换清理）、tests/edit-draft.test.ts
  Produces: `injectEditIntent`/`hasEditIntent`/`stripEditIntent` 纯函数、
    ResultsPanel「让 Agent 改这份」按钮（仅文本预览显示）、输入区草稿注入（不自动发送）
  RED/GREEN: 4 项（空/已有草稿注入/幂等/strip 保留用户内容/跨路径隔离）
  Concerns: 只注入文本引用，复用普通 send 流程，无 Artifact 专用执行入口；
    切换会话时按 editRef 清理旧会话注入的引用；不允许预览区直接改文件

A09 "Blob 引用计数与恢复清理" — complete
  Commits: （本 Slice）
  Files: src/runtime/blob/blob-ref-repository.ts、blob-cleanup.ts、
    src/infrastructure/sqlite/migrations/015_app_blob_refs.sql、sqlite-blob-ref-repository.ts、
    src/runtime/blob/blob-store.ts（delete 改按 hash、新增 list）、node-fs-blob-store.ts、
    src/main/bootstrap/create-application.ts（引用登记/启动扫描）、create-legacy-runtime.ts
    （会话删除钩子）、src/runtime/index.ts、sqlite/index.ts、app-database.ts、
    tests/unit/runtime/blob-cleanup.test.ts
  Produces: `BlobRefRepository`（attachment/artifact/tool-output 三类引用，ref_key 以 sessionId 开头）、
    `createBlobCleanup`（deleteSession 先删引用再物理清理、sweepOrphans 孤儿+tmp 扫描）、
    启动幂等清理、会话删除联动、BlobStore.delete(hash)/list()
  RED/GREEN: 4 项（共享 blob 保留/最后引用删除/孤儿+tmp 扫描/删除幂等）
  Concerns: referencedHashes 并入 attachments/artifacts 源表（重启重建引用不遗漏）；
    引用登记点在 persistAttachments/storeToolOutput/projectArtifact 三处；
    M4 全 gate 通过，E2E 在里程碑收口统一回归
