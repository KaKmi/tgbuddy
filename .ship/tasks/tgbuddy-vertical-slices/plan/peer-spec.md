# TgBuddy 细粒度纵向切片规格（独立调查）

## 1. 结论与范围

本计划将 TgBuddy 定位为**基于用户自有功能设计的通用、本地优先桌面智能体**：核心能力为 Agent 运行、内置工具、权限、Workspace、Artifact、MCP 和 Skill；不把任何外部产品的复刻作为目标。`tgbuddy-mockup/TgBuddy 交互原型.dc.html` 是 UI、状态与交互时序的唯一事实源，七个场景分别是空状态、主窗口、工具四态、权限、上下文压缩、会话列表和设置。[docs/06-设计决策.md:3-5] [AGENTS.md:552-571]

已完成的 packaged SQLite Spike 和 Story 1A 不重做：当前 HEAD 已有 `TgBuddyRuntime`、唯一 Composition Root、typed IPC map 和架构检查，开发从其后开始。[AGENTS.md:201-205] [docs/07-代码仓库设计.md:16-18] 现有大 Story 1B–6 不能继续作为实施单元；它们会被下文的 22 个可验收切片替代。每个切片都必须交付一个真实行为、一条最短 Runtime→IPC→Preload→Renderer 证明路径以及一个可单独执行的测试集合，不能只建目录、接口或 mock 页面。

### 明确非目标

- 不引入 `pi-coding-agent` 的 CLI/TUI、独立 SDK、插件 ABI、团队 DAG、分支会话或云端协作；产品会话仍是线性日志。[docs/01-架构设计.md:26-34] [docs/06-设计决策.md:102-121]
- 不把 UI 延后到“最终大改版”：每一个用户可见后端能力在同一切片至少显示一次真实数据或真实事件；纯基础设施切片必须被紧随的可见行为切片消费。
- 不以放宽断言、fixture 特判、吞掉存储错误、生产 JSONL 双写或扩大 legacy 例外换取通过。[AGENTS.md:488-490] [AGENTS.md:595-598]

## 2. 已调查事实与调用链

### 2.1 进程入口与当前生产链路

Electron 在 `src/main/index.ts` 创建窗口、调用 `createApplication()`，退出前调用 `application.dispose()`；它不应成为业务 owner。[src/main/index.ts:20-46] [src/main/index.ts:62-79] `createApplication()` 是唯一 Composition Root，但当前仍调用 `createLegacyRuntime()`，后者把 Runtime 的每一项依赖委托给旧 Main 模块。[src/main/bootstrap/create-application.ts:15-29] [src/main/bootstrap/create-legacy-runtime.ts:1-72]

真实的用户发送路径是：`App.send()` → `window.tgbuddy.agent.send()` → `IPC.AGENT_SEND` handler → `runtime.runs.send()` → legacy `orchestrator.send()` → `new Agent()`/pi stream → `eventFromPi()` → Runtime subscriber → BrowserWindow event → `useGlobalAgentListeners()` → Jotai state → `App`/工具卡、权限卡与压缩 UI。[src/renderer/App.tsx:82-91] [src/preload/index.ts:29-36] [src/main/ipc.ts:61-70] [src/main/bootstrap/create-legacy-runtime.ts:28-32] [src/main/orchestrator.ts:142-206] [src/renderer/hooks/useGlobalAgentListeners.ts:75-115] [src/renderer/App.tsx:170-222]

会话路径是 `App.newSession/selectSession()` → preload → IPC → `TgBuddyRuntime.sessions` → legacy `session-store`；该 store 当前直接维护 `sessions.json`、每会话 JSONL、进程内缓存和 `appendMessage()`。[src/renderer/App.tsx:70-80] [src/main/ipc.ts:23-59] [src/runtime/app/tgbuddy-runtime.ts:27-40] [src/main/session-store.ts:1-28] [src/main/session-store.ts:65-106] [src/main/session-store.ts:329-401]

权限、Plan、ask_user、压缩同样是 renderer 卡片经 IPC 回写，当前由 Main 的模块级 service/map 持有；删除会话时 Runtime 现有顺序是 clear compaction、删除 session、expire session rule。[src/main/ipc.ts:72-132] [src/runtime/app/tgbuddy-runtime.ts:137-202] [src/main/permission-service.ts:76-112] [src/main/plan-service.ts:18-39] [src/main/pending-request.ts:9-61] [tests/unit/runtime/tgbuddy-runtime.test.ts:77-119]

### 2.2 已有契约、消费者与需收紧的接口

`TgBuddyRuntime` 已将 workspace/session/run/permission/plan/question/context/artifact/capability/settings 分组，并以单一 `subscribe()` 发布 `StreamFrame`；新切片应扩展这一公开面，而不是让 Main/Renderer 重新 import repository 或 service。[src/runtime/app/tgbuddy-runtime.ts:23-121] [src/runtime/app/tgbuddy-runtime.ts:123-213] IPC 的命令/响应 map 是唯一类型源，preload 已通过 `satisfies TgBuddyAPI` 校验，Main IPC 已只调用 Runtime 门面。[src/shared/contracts/ipc.ts:82-188] [src/preload/index.ts:15-64] [src/main/ipc.ts:13-157]

已存在但尚未真实填充的契约包括 `Workspace`/`WorkspaceMount`、`RunRecord`/`RunLineage`、`ArtifactRef` 和 `CapabilityDescriptor`；不要新造第二套 DTO。[src/shared/contracts/workspace.ts:1-15] [src/shared/contracts/run.ts:1-18] [src/shared/contracts/artifact.ts:1-15] [src/shared/contracts/capability.ts:1-13]

消息使用 pi 原始 message 信封及 `kernel: 'pi@0.82'`，`message_end` 是可落盘点；事件与宿主事件已区分为 `agent`/`host` 两个 channel。[src/shared/contracts/message.ts:19-23] [src/shared/contracts/message.ts:50-115] [src/shared/contracts/events.ts:18-49] [src/shared/contracts/events.ts:64-103] 因此不能将 delta 当 durable message，也不能为 SQLite 做不可逆的“统一消息翻译”。

### 2.3 现有行为、测试资产与缺口

现有测试已覆盖晚到 run frame、待处理请求快照合并、120ms 工具显示前置状态、压缩阈值/队列和 Runtime 删除顺序；这些是迁移回归资产，必须迁入对应切片而非删除。[tests/agent-concurrency.test.ts:17-72] [tests/compaction.test.ts:15-26] [tests/compaction.test.ts:174-217] [tests/unit/runtime/tgbuddy-runtime.test.ts:77-119]

SQLite Spike 已有 packaged runtime、session isolation、crash recovery、compaction、delete/cleanup、backup/restore 与 legacy import 九场景门槛；生产 SQLite 只能提取其解析/映射逻辑，不能复制启动器和场景编排。[tests/sqlite-spike.test.ts:249-330] [AGENTS.md:237-251] `@earendil-works/pi-storage-sqlite-node` 仍在 devDependencies，生产切换要精确提升为与 pi 0.82.1 对齐的依赖。[package.json:24-42]

当前 `orchestrator` 仍创建裸 `Agent` 并使用模块级 `activeRuns`、`runningAgents`、`stoppedByUser`；它已仅在 `message_end` 追加消息，但 `agent_end` 的 stopReason 被硬编码为 `stop`。这是 Run 生命周期和恢复两个独立缺口，不能与所有后续功能混成一个 Story。[src/main/orchestrator.ts:14-31] [src/main/orchestrator.ts:46-55] [src/main/orchestrator.ts:171-246] [src/kernel/normalize.ts:35-89]

原型已有完整的目标状态：工具状态色与标签、原始输出展开、权限 pending/running/ok/denied、压缩分隔线、Workspace 切换、会话分组、MCP 连接状态、Skill 分组和设置导航。[tgbuddy-mockup/TgBuddy 交互原型.dc.html:304-495] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1030-1035] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1118-1216] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1235-1263] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1517-1525]

## 3. 不可突破的架构和迁移界线

依赖方向固定为 `shared <- runtime`、`shared + runtime ports <- kernel/pi|infrastructure`、`main/bootstrap` 显式装配、Main IPC 只见 Runtime 公共 API、preload/renderer 只见 shared contract。[docs/07-代码仓库设计.md:35-67] Runtime 禁止 import Electron、React、Node fs、SQLite、pi 与具体 infrastructure；pi 运行时调用仅在 `src/kernel/pi/**`；不得新增通用 DI 容器。[AGENTS.md:161-169]

所有切片须运行 `bun run check:architecture`，并维持其对 dynamic import、aliases、pi type-only 例外和 legacy 白名单的回归保护。[tests/unit/architecture/import-boundaries.test.ts:55-203] 每个切片也至少运行 targeted tests、typecheck、全量 `bun test`、build；kernel/SQLite 切片分别额外运行 probe/spike。[docs/07-代码仓库设计.md:154-156] [AGENTS.md:539-546]

旧删除期限在更小切片中的映射如下，**不延长**原承诺：

| 原期限 | 新切片的最晚 cutover | 必须删除/收缩的 owner | 依据 |
|---|---|---|---|
| Story 1B | S04 | `session-store` 停止 canonical JSONL，仅可作 SQLite SessionService 委托 | [AGENTS.md:242-244] |
| Story 1C | S08 | 删除 `orchestrator.ts`、`compaction-service.ts`、`session-store` adapter 与旧 `src/kernel/*.ts` owner | [AGENTS.md:278-284] |
| Story 2 | S12 | 删除 Main permission/plan/ask_user/global sandbox owner | [AGENTS.md:320-325] |
| Story 4 | S16 | 删除 Main channel/tool/plan-mode/ask-user owner | [AGENTS.md:386-391] |
| Story 6 | S22 | 删除单一 `main/ipc.ts`、`shared/types` re-export、总 atom/总 listener | [AGENTS.md:422-435] |

兼容层仅能委托旧实现、必须标注删除切片、不得承接新功能；没有这三项任一项即为失败。[docs/07-代码仓库设计.md:148-152]

## 4. 纵向切片规则

每个切片遵循 Red→最小实现→真实边界证明→回归的短环：

1. 先在该切片的 unit/integration test 写一个失败的业务断言；不测试 private implementation。
2. runtime service 只依赖 port；infrastructure/kernel 实现 port；`createApplication()` 进行显式装配。[docs/07-代码仓库设计.md:94-119]
3. 增加或复用一个 typed IPC command/event，preload 使用同一 map，Renderer 提取一个纯 reducer/view-model 并由 Bun 测试；然后在 prototype 对应 scene 做一次截图或可复现手动 smoke。当前 renderer 已按 event→atom→组件消费，可渐进拆成 feature reducer，不能先造第二条数据流。[src/renderer/atoms/agent.ts:64-171] [src/renderer/hooks/useGlobalAgentListeners.ts:75-115]
4. 若切片无独立 UI，它只能是紧随的“可见行为切片”的内部前半段，且两者合并提交/验收；不允许单独标记完成。

“最小 UI 证明”不要求每个切片都重做三栏：必须能在主窗口、设置抽屉或空状态中看到真实 Runtime 结果，且可用同一 IPC 操作驱动。建议把对 renderer 的可测试规则抽为无 DOM 的 `features/*/state.ts` 或 `view-model.ts`，保留组件只做渲染；这比在当前没有 DOM 测试框架的仓库中伪造点击更快，也能保留现有纯函数测试模式。[tests/agent-concurrency.test.ts:1-72] [tests/context-usage.test.ts:1-61]

## 5. 建议实施序列（22 个小型、可独立验证的切片）

### A. 先使“线性、可恢复会话”成为真实 UI

| 切片 | 一个完成行为与原型状态 | 最小变更边界与实时 UI 证明 | TDD 验收 |
|---|---|---|---|
| S01 SQLite 启动与 catalog | 应用启动打开 migration 后的 app SQLite，真实 session list 驱动“整窗空状态/新建会话”，而不是 legacy JSON 文件。对应 empty/main/sessions。 | 新增 `runtime/sessions` port、`infrastructure/sqlite/app-database` + migration、SQLite session catalog repo；Composition Root 注入；保留现有 `session:list/create` IPC，App 左栏继续消费。表只用 `app_*`，不触及 pi 表。 | migration/reopen、create/list 排序、IPC map/preload/register 一致性、`App` session-list view-model 空/非空；`bun run spike:sqlite`。禁止只建 schema 或保留 JSONL 双写。[AGENTS.md:217-251] [src/shared/contracts/session.ts:21-44] [src/renderer/App.tsx:62-80] |
| S02 Workspace picker 的真实 catalog | 创建/列出/选择逻辑 Workspace，左上 picker 显示名称、路径、会话数；尚不允许路径访问。对应原型 workspace 下拉。 | 实现 Workspace repository/service，扩充 `workspaces` IPC/API；Renderer 提取 Workspace selector feature。Session 新建可带 workspaceId。 | workspace create/list/select、session workspaceId 归属、IPC smoke、picker view-model；点击选择后左栏只查询该 Workspace 的 sessions。禁止将 path 当 workspace ID。[src/shared/contracts/workspace.ts:3-15] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:96-102] [docs/06-设计决策.md:171-185] |
| S03 durable message/replay | 一次发送只在完整 `message_end` 后持久化；重启后线性时间线恢复完整消息而非 delta。对应主窗口历史。 | SQLite message repo + SessionService 替换 `getMessages/appendMessage`；先用 fake AgentEngine 驱动 Runtime event，再经已有 `agent:stream` 刷新 Renderer。 | 只持久化 `message_end`、崩溃留下 delta 不恢复、reopen 重放、消息 IPC 与 timeline view-model；真实 pi 事件转换 contract。禁止把流式 buffer 写入 DB。[src/shared/contracts/events.ts:23-49] [src/main/orchestrator.ts:183-187] [AGENTS.md:248-251] |
| S04 linear edit / origin | “编辑并重发”产生 soft truncate；“以此为起点新建会话”保存 `originRef`；列表和时间线可复现线性历史。对应 sessions scene。 | Session repo 实现 transaction、truncate、origin，新增有限 IPC 命令；Renderer 只实现原型菜单的这两个动作，不做 branch tree。旧 `session-store` 收缩为 SQLite delegate。 | create/list/update/truncate/origin/delete/transaction/reopen 全部 contract；两次 truncate、origin 不复制树、UI menu view-model；legacy store 不再 append。禁止 `parentId` 树或物理删历史。[docs/06-设计决策.md:102-121] [src/shared/contracts/session.ts:61-78] [AGENTS.md:242-244] |
| S05 legacy transfer + 恢复诊断 | 启动先备份、幂等导入 JSONL、写 marker；坏行在可见 diagnostics 中显示相对文件+行号，成功后 UI 可见同一批会话。 | 提取 spike 的 parse/map 到 importer/exporter/backup service，Runtime diagnostics query，设置/空状态辅助提示。 | 重复 import、坏行定位、model_change/truncate 兼容、backup 先于 marker、失败保留源文件；运行 packaged spike。禁止复制 spike launcher/packager，禁止失败后静默空数据。[tests/sqlite-spike.test.ts:300-329] [AGENTS.md:237-243] |

### B. 再收口 AgentHarness、Run 和对话过程

| 切片 | 一个完成行为与原型状态 | 最小变更边界与实时 UI 证明 | TDD 验收 |
|---|---|---|---|
| S06 PiAgentEngine 事件忠实适配 | `PiAgentEngine.run()` 将 pi run、text/thinking、tool、error、正确 stopReason 映射为 `AgentEvent`，并保证 `message_end` 才是 durable 点。对应主窗口流与错误条。 | 新建 runtime `AgentEngine` port 和 `kernel/pi` adapter；用 fake engine 做 coordinator test，再用 probe 覆盖真实 pi。 | error 不静默、message_end 信封、event 顺序、无 assistant 时 stopReason、probe；Renderer stream reducer 能显示 error。禁止 `agent_end => 'stop'` 硬编码。[src/kernel/normalize.ts:35-89] [src/renderer/App.tsx:217-222] [AGENTS.md:278-280] |
| S07 单 Session 防重入与停止 | 同一 session 第二次 send 被拒绝，不同 session 可并行，stop 幂等，旧 frame 被丢弃。对应输入区停用/停止和两条会话独立状态。 | `RunRegistry`、`CancellationScope`、`RunCoordinator` 替换模块级 map；保留 `agent:send/stop` API。 | same-session reject、cross-session parallel、late frame reject、double stop、settled 清 registry；新 Runtime contract test + renderer reducer test。禁止模块级运行 Map。[src/main/orchestrator.ts:46-63] [tests/agent-concurrency.test.ts:17-25] [AGENTS.md:279-282] |
| S08 settled cutover + recovery | run 结束/崩溃时 pending request 清空、running Run 变 `interrupted`，Agent/request 不残留；此时删除裸 orchestrator/旧 compaction/session adapter。 | Run repo persistence、startup recovery、`createApplication` 完整装配 PiAgentEngine + RunCoordinator；原型主窗口可显示停止/错误后稳定终态。 | kill/reopen marks interrupted、pending 清理、dispose waits settled、真实 send path no legacy imports；probe/full gates。禁止将旧 owner 留作 fallback 或在存储失败后继续执行。[src/main/orchestrator.ts:224-246] [src/main/index.ts:71-76] [AGENTS.md:282-290] |
| S09 工具卡片真实四态 | `tool_start` 后 120ms 才 running，权限请求先到则 pending；成功折一行，失败/pending 展开、denied 可见。对应 tools/perm scene。 | 将工具活动 reducer 提取为 conversation feature；RunCoordinator 直接发布现有 typed frames；不先重做整套 UI。 | fake clock 下 120ms、请求取消 timer、tool_end 成功/失败/拒绝、run_end 清 live card；截图对原型状态。禁止按事件到达顺序立刻显示 running。[docs/06-设计决策.md:27-49] [src/renderer/hooks/useGlobalAgentListeners.ts:68-73] [src/renderer/atoms/agent.ts:227-306] |
| S10 上下文用量面板 | 每次 turn 后显示 provider usage 与 system/tools/messages 明细；UI 面板与 session meta 同步。对应 context panel。 | Context usage service/adapter 通过 Runtime `context_usage` event；把当前 panel 行计算迁进 feature model。 | provider total 优先、分类不会负值/超总量、session A/B 隔离、IPC/reload 后可读；不改变现有 token 估算语义。[src/kernel/context-usage.ts:35-120] [tests/context-usage.test.ts:16-61] |
| S11 自动压缩交互 | 85% 触发 3 秒“稍后”，运行中的请求排队，压缩后显示可展开 divider 且原消息可查。对应 context scene。 | Runtime ContextService/CompactionPolicy + pi adapter；保留 `compaction:*` command，conversation feature 消费 host events。 | 85%、defer、beforeModelCall、queued/cancel/restart、divider detail；probe:compaction。禁止锁死输入或把已压缩数据删除。[docs/06-设计决策.md:90-98] [tests/compaction.test.ts:15-26] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1188-1216] |

### C. 在真实 Workspace 中让权限和工具安全运行

| 切片 | 一个完成行为与原型状态 | 最小变更边界与实时 UI 证明 | TDD 验收 |
|---|---|---|
| S12 Mount rebind + per-run path boundary | Workspace 的真实目录可重新绑定；每个 run 固定 mount snapshot，A/B run 不串路径。对应 picker 与 sessions scene。 | `runtime/workspaces` mount resolver、filesystem canonical-path port/adapter、每 Run 注入 immutable `ExecutionEnv`。 | relocate 后 session/rule/plan/artifact 均仍归 workspaceId，reject `..`/absolute escape/symlink/junction/reparse/非法新建父路径，A/B roots 隔离。禁止 global `configureSandbox()`。[AGENTS.md:297-325] [src/main/tools/sandbox.ts:37-62] [src/shared/contracts/workspace.ts:3-15] |
| S13 builtin ToolRegistry | 真实 builtins 从描述符和 per-run env 构造，不从 Main `tools/index` 直接拼装；设置“工具”页显示 allow/ask/deny。对应 settings/tools。 | Runtime ToolRegistry port、kernel pi tool adapter；Renderer tools settings feature；控制工具暂保留到 S15 后删除旧 owner。 | builtin descriptor/risk、只读/写/命令 env route、setting 保存后下一次 invocation 生效；不让 Tool 直接 fs。禁止把 descriptor 藏在 Renderer 或按名称猜风险。[AGENTS.md:322-323] [src/main/tools/index.ts:64-66] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:753-789] |
| S14 Permission policy + request card | PolicyEngine 根据 tool×path/prefix/method×scope 产生真正权限卡；高危不可逆不持久化。对应 perm scene。 | runtime permission repository/service/broker 替换旧 Main module；permission IPC 继续回 Runtime；card 消费真实 `PermissionRequest`。 | plan/auto/bypass，read/write/destructive，session/workspace/global，grant 与 deny，`neverPersist`；不可持久化命令没有“总是允许”。禁止 `mcp__` 整体放行。[src/shared/contracts/permission.ts:9-105] [docs/06-设计决策.md:55-86] [AGENTS.md:313-318] |
| S15 Plan + ask_user 作为同一控制路径 | plan 模式先提交计划、批准后执行；ask_user 返回结构化回答；停止时二者均解除。对应主窗口内卡。 | 将 Plan/Question 从 Main owner 迁到 runtime control-tool descriptors + brokers；保留既有 IPC/Renderer card。 | control tools 不被 policy 拦截、approve/reject/abort、pending restore/clearSession、response 到模型；最终删除 `permission-service/plan-service/ask-user-service/sandbox` legacy owner。禁止把这三种请求只放在 Renderer 内存。[tests/permission-control-tools.test.ts:8-25] [tests/ask-user.test.ts:15-36] [tests/plan-mode.test.ts:4-23] |

### D. 让产物、渠道、Skill、MCP 成为可管理的产品能力

| 切片 | 一个完成行为与原型状态 | 最小变更边界与实时 UI 证明 | TDD 验收 |
|---|---|---|---|
| S16 Blob 写入与长输出投影 | 长 Tool output/附件写 Blob，消息只存 preview/ref；ToolCard “展开完整输出”读取真实 Blob。对应 tools scene 的展开按钮。 | BlobStore port + file adapter/staging rename，消息 projection；扩展 message/artifact contract 但不破坏 pi envelope。 | >256KB 不入 payload、preview/ref、atomic staging recovery、missing Blob degraded、full output IPC/read view-model。禁止把 Base64/完整输出回写 Session。[AGENTS.md:331-355] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1133-1157] |
| S17 Artifact 索引与结果区 | write/edit 或成功 tool result 推导 Artifact，右侧结果区按 session 可恢复展示预览/producer。对应主窗口 results/会话 artifact badge。 | ArtifactRepository/Service + Runtime artifacts command + typed IPC；renderer artifacts feature。 | 由 args+成功 result 推导、workspace/session/toolCallId/lineage、session 删除仅回收无引用 Blob、不删 Workspace file、reopen list。禁止依赖 pi `details` 或用 artifactCount 代替索引。[src/main/session-store.ts:294-326] [src/shared/contracts/artifact.ts:3-15] [AGENTS.md:344-349] |
| S18 Secret-backed Channel | 模型与密钥设置显示脱敏 DTO，key 仅由 SecretStore 在 kernel 调用时解析；现有 channels.json 明文路径退出生产。对应 model settings。 | runtime ChannelService/repo port、Electron secret adapter、PiModelCatalog；settings IPC/feature。 | repo/renderer DTO 不含 key、save/list/delete/test、model resolve 获取 key、迁移旧设置；不允许 API key 出现在普通配置/日志。[src/shared/contracts/channel.ts:46-54] [src/kernel/models.ts:48-75] [AGENTS.md:362-364] |
| S19 Skill snapshot | Workspace 切换的 Skill 列表按来源分组；默认只注入摘要，显式 `/skill` 才加载正文。对应 settings/skills 与输入 Skill 菜单。 | SkillRegistry port、pi skill loader、capability snapshot，renderer skills feature。 | workspace source、enable/disable、Windows separators、path escape reject、next invocation only、usage.skills；禁止把全部 Skill body 塞 prompt。[AGENTS.md:378-381] [docs/06-设计决策.md:158-163] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1243-1263] |
| S20 MCP lifecycle | MCP 服务卡显示 connected/error/off、连接/重连/日志；断开后下一 invocation 去除其 tools 并显示 host error。对应 settings/mcp。 | MCP manager + stdio transport + tool descriptor/capability snapshot；新增领域 IPC handler 并以同一 typed API 接到 settings feature。 | fake MCP discover/call/timeout/disconnect/reconnect、server/method/risk policy、断线移除下一轮工具、long output Blob。禁止仅隐藏 UI 开关而仍向模型提供断线 Tool。[AGENTS.md:382-391] [docs/06-设计决策.md:156-161] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1235-1240] |

### E. S21 单层 child delegation

delegation 的 cancellation、budget、lineage 与 MCP 无直接依赖，故必须单列为 S21，不与 MCP 或 UI 收口混做。root 至多两个 child、最大深度 1；child 使用独立 pi session 但与 root 共用 budget/cancellation，过程、permission、artifact 和 token metric 都携带 lineage，并以 `toolResult` 回父。原型有可展开“子智能体”过程组，正好是最低 UI 证明。[AGENTS.md:397-417] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1172-1175]

TDD 验收：前两个允许、第三个（包括失败 child）拒绝、depth>1 拒绝；child capability snapshot 没有 delegate tool；root cancel 中止 child/broker/promise；parent 等待时 child stream 不死锁；RunLineage 的 `rootRunId/agentRunId/parentToolCallId` 在 event/artifact/permission/metric 中均可观测。[src/shared/contracts/run.ts:3-18] [AGENTS.md:403-409] 禁止递归 delegation、独立 child budget、或只在 UI 画分组却不持久化真实 lineage。

### F. S22 feature 收口与最终恢复验收

只在前述行为均已有独立 owner 后，拆分 `main/ipc.ts` 为领域 handler，完成 Renderer `features/*` 迁移、删除 `shared/types` re-export、总 atom/总 listener，并将 App 收敛为三栏组合。此切片的可见证明是七个 prototype 场景均由真实 feature state 驱动，且无旧 bridge；它不重新实现任何业务规则。[AGENTS.md:422-446] [src/renderer/main.tsx:8-23]

TDD 验收：每 command 均有 handler/preload method、handler 仅 import Runtime public API；事件 router 仅路由不解释业务；旧 run 丢弃、pending snapshot、切换 session 不丢流；执行最终七个 packaged E2E 和完整 gate。禁止在此切片补写 S01-S21 的领域功能，或把 feature state 再聚合回全局 atom。[AGENTS.md:449-476] [docs/07-代码仓库设计.md:63-67]

## 6. Prototype 场景到实现切片的覆盖矩阵

| 原型场景/状态 | 首次真实接入 | 回归切片 | 关键事实 |
|---|---|---|---|
| ① 整窗空状态、样例与“过程/结果”说明 | S01 | S02/S17 | `setScene('empty')` 同时打开 results；空状态是主用例而非占位。[tgbuddy-mockup/TgBuddy 交互原型.dc.html:1092-1101] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1269-1280] |
| ① 主窗口、线性 session timeline | S03 | S04/S08 | 原型明确不做 branch/time travel；现有 App 已消费 messages/stream。[docs/06-设计决策.md:102-121] [src/renderer/App.tsx:159-224] |
| ② 工具 pending/running/ok/fail/denied 和折叠 | S09 | S13/S16 | 原型 state table + 120ms rule；成功安静、异常突出。[tgbuddy-mockup/TgBuddy 交互原型.dc.html:1030-1035] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1524-1528] |
| ③ 权限 inline/高危 modal/规则 | S14 | S15/S20 | 组合粒度和不可持久化已是 contract 语义。[src/shared/contracts/permission.ts:13-66] [docs/06-设计决策.md:82-86] |
| ④ 用量、85%/3 秒/queue、expandable divider | S10 | S11 | 原型要求输入不锁、原消息仍保留。[docs/06-设计决策.md:90-98] |
| ⑤ workspace picker、session 分组、truncate/origin | S02 | S04/S12 | 会话 metadata 现有 `workspaceId`/`originRef` 字段。[src/shared/contracts/session.ts:23-41] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1296-1313] |
| ⑥ 结果区、完整 output、artifact badge | S16 | S17 | 原型限制默认 output 行数并提供完整展开。[tgbuddy-mockup/TgBuddy 交互原型.dc.html:1133-1157] |
| ⑦ 工具、模型密钥、MCP、Skill 设置 | S13 | S18-S20 | MCP 关闭须让 tool 从 agent 可用列表消失，Skill 随 workspace 切换。[docs/06-设计决策.md:156-163] |
| 子智能体过程组 | S21 | S17/S20 | 仅单层、可展开、可持久化；不是 Team 产品。[AGENTS.md:393-417] |

## 7. 跨切片验收、风险与禁止测试投机

### 全局验收

- 每个切片先 Red，再 targeted test、architecture、typecheck、full `bun test`、build；SQLite 运行 `spike:sqlite`，pi kernel 运行 `probe`，renderer 改动需 screenshot/runtime QA。[AGENTS.md:480-509] [AGENTS.md:539-546]
- S08 后生产调用树不得再 import `src/main/orchestrator.ts`、`compaction-service.ts`、`session-store.ts` 或旧 `src/kernel/*.ts`；S15/S22 后同理删除各自截止 owner。用 `rg` 加 architecture test 作为负向断言，而非只人工检查。[AGENTS.md:171-194] [tests/unit/architecture/import-boundaries.test.ts:193-203]
- 最终必须重放七个产品 E2E：附件/重启、workspace rebind、两会话隔离、>256KB 输出、MCP 断线、两个 child 后拒绝及级联取消、强杀只恢复完整 `message_end`。[AGENTS.md:449-467]

### 主要风险与处置

| 风险 | 处置与证据 |
|---|---|
| pi stream 不抛异常而以 event 报错 | S06 将 `error` 作为必须穿透的 contract；已有注释明确该陷阱和 App error consumer。[src/shared/contracts/events.ts:43-49] [src/renderer/App.tsx:217-222] |
| 工具开始在授权请求前约 5ms 到达 | S09 以 fake clock 测 120ms 延迟，不以 UI snapshot 假定事件同帧。[docs/06-设计决策.md:31-41] |
| SQLite 与 pi 私有 schema 耦合 | `app_*` 表没有指向 pi 的 FK/trigger/字段依赖；以 schema inspection test 阻断。[AGENTS.md:237-240] |
| path guard 在 Windows junction/symlink/待创建路径被绕过 | S12 用真实临时目录的 integration tests，且所有文件 tool 强制经 per-run ExecutionEnv。[AGENTS.md:313-324] |
| 配置变更污染正在运行的 Agent | S18-S20 的 capability snapshot 只影响下一 invocation，显式测试运行中变更。[AGENTS.md:378-384] |
| “可见 UI”被 mock data 伪造 | 每个 UI proof 必须使用 Runtime 生成的 DTO/event；prototype 只提供视觉/状态规则，绝不作为数据源。[src/runtime/app/tgbuddy-runtime.ts:79-121] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1265-1281] |

### 禁止快捷方式

不得用空 repository、虚假的 `success: true` channel test、硬编码 prototype 数据、跳过 packaged spike/probe、扩大 compatibility 白名单、从 Renderer 读磁盘/API key、向 Runtime import SQLite/pi/Electron、或为可见卡片另建不经 RuntimeEvent 的事件总线。[docs/07-代码仓库设计.md:57-67] [src/main/bootstrap/create-legacy-runtime.ts:53-70] [AGENTS.md:161-169]

## 8. 未决但不阻塞的实施假设

1. 原型是 UI/行为事实来源而非领域数据样本；展示中的 workspace 名、SQL、报告与 connector 均为演示内容，不能写入 product fixture。此结论来自原型把这些值置于 `connData()`、`toolCards()` 和 `sessionsByWs` 的组件本地状态中。[tgbuddy-mockup/TgBuddy 交互原型.dc.html:1118-1129] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1235-1263] [tgbuddy-mockup/TgBuddy 交互原型.dc.html:1296-1313]
2. 本规格明确为 22 个切片：S20 MCP、S21 child、S22 前端收口，三者均不应合并。理由是 child 的预算/取消/lineage 既跨 run 又跨 storage，而前端收口的风险是边界回退，验收面彼此独立。[AGENTS.md:403-417] [AGENTS.md:422-435]
3. 在 S06 开始前必须实际审计本地 pi 0.82.1 的 `AgentHarness`、session backend、settled、compaction/tool hook 声明；当前 repo 中只有旧 `Agent` 使用和设计要求，不能从旧代码猜 API。[AGENTS.md:278-280] [src/main/orchestrator.ts:14-31]

## 9. 自检

- 已将目标表述为通用桌面智能体，未使用“Prom 复刻”作为目标。
- 所有计划项均有一个可观察行为、对应原型场景或状态、最小 Runtime/IPC/Renderer 证明和测试，不存在仅 scaffolding 的切片。
- 未把完成的 Spike/Story 1A 重复纳入实现；保留其回归门槛。
- 未发现需要用户选择才能继续的领域歧义；pi API 的具体形式被限定为 S06 的先验审计，不以猜测写进实现。
- 已明确禁止通过 fixture、硬编码、旧 owner 或扩张白名单测试投机，并保留所有原 compatibility 删除期限。
