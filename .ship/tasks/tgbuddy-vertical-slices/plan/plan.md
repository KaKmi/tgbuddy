# TgBuddy 通用智能体纵向切片开发计划

> 执行入口：`$ship:dev`  
> 规格：`.ship/tasks/tgbuddy-vertical-slices/plan/spec.md`  
> 产品定位：按用户自有设计开发的通用桌面智能体，内核优先，核心支持 Tool、MCP、Skill。

## 0. 执行规则

### 0.1 已完成基线

| ID | 状态 | 交付 |
|---|---|---|
| B00 | ✅ | Packaged Electron SQLite Spike、崩溃恢复、WAL 备份、legacy import |
| B01 | ✅ | 仓库边界、shared contracts、Runtime 门面、Composition Root、架构检查 |
| R01 | ✅ | `AgentRuntime` 唯一门面、统一事件与 Host Adapter 语义 |
| R02 | ✅ | `StartRunInput` 与 Runtime/RunCoordinator `start()` 语义链 |

后续不重做 B00/B01/R01/R02，也不再以旧 Story 1B–6 为开发单位。

### 0.2 Slice 尺寸

- 每次 `$ship:dev` 默认只领取 **1 个 Slice**。
- 单个 Slice 只允许 1 个主要行为，目标规模 0.5–1.5 个开发日。
- 默认不超过 6 个生产文件；超过时先拆分或在 ledger 说明原因。
- 纯基础设施 Slice 后面必须紧跟一个真实消费者；不得连续堆积后端框架。
- 每个 Slice 独立提交，提交信息使用 `feat(<slice-id>): ...` 或 `fix(<slice-id>): ...`。

### 0.3 固定验证

每个 Slice 至少执行：

```bash
bun run check:architecture
bun run typecheck
bun test
```

按改动追加：

```bash
bun run probe          # kernel/pi/Run/Context
bun run build          # Main/Preload/Renderer/打包入口
bun run spike:sqlite   # SQLite backend、迁移、恢复、import
bun run dev            # 有用户可见交互时人工核对
```

每个里程碑末尾必须执行全部 gate，并在 `.ship/tasks/<slice-id>/dev-ledger.md` 留证据。

执行节奏按用户决定调整为：K01–K17 保持一个 Slice 一个 commit，只做对应
targeted gate；K17 后、M1 E2E 前做一次整体独立 review 和集中修复，不再逐
Slice 等待 peer review。

## 1. 路线总览

| 顺序 | 里程碑 | Slice | 可演示结果 |
|---:|---|---|---|
| 1 | M1 可恢复 Agent 内核 | K01–K17 | 会话、消息、流式、停止、工具、恢复、压缩、线性历史 |
| 2 | M2 Workspace 与安全 | S01–S11 | 工作区隔离、授权规则、高危确认、计划与提问 |
| 3 | M3 通用能力系统 | C01–C12 | Channel、Profile、Tool、Skill、MCP 进入真实 Run |
| 4 | M4 附件与结果 | A01–A09 | Blob、附件、长输出、Artifact、结果区与预览 |
| 5 | M5 单层子 Agent | D01–D04 | child run、预算、取消、权限与折叠展示 |
| 6 | M6 产品收口 | U01–U09 | 7 个原型场景、7 条 E2E、完整第一版 |

依赖主链：

```text
K01 -> K02 -> K03
K04 -> K05 -> K06
K07 -> K08 -> K09 -> K10 -> K11 -> K12 -> K13 -> K14
K05 -> K15 -> K16 -> K17
K17 -> R01 -> R02 -> S01 -> ... -> S11
S11 -> C01 -> ... -> C12
C12 -> A01 -> ... -> A09
A09 -> D01 -> ... -> D04
D04 -> U01 -> ... -> U09
```

## 2. M1 · 可恢复 Agent 内核

### K01 · AppDatabase 迁移协议与 packaged 证明

- **依赖**：B00、B01。
- **行为**：packaged Electron 能打开 `userData/tgbuddy.db`，只管理 `app_schema_migrations` 与 `app_*` 表；首次迁移、重复 reopen 和 close 都稳定。
- **原型锚点**：基础设施，无新增画面。
- **物理边界**：app 表和 pi backend 私有表共用一个物理文件 `tgbuddy.db`，使用各自连接和迁移协议。TgBuddy 迁移表固定为 `app_schema_migrations`，所有产品表固定 `app_*`；不得读取、写入、FK/trigger 依赖 pi 的 `migrations/sessions/session_entries/...` 私有表。
- **文件**：新建 `src/infrastructure/sqlite/app-database.ts`、`src/infrastructure/sqlite/migrations/001_app_bootstrap.sql`；扩充现有 packaged spike 的 runtime/scenario/main/test，使其中一个场景直接 import `AppDatabase`。
- **RED**：packaged 场景在临时 `tgbuddy.db` 连续 open 两次，断言 `app_schema_migrations` 只有一条稳定记录、无业务表、关闭后可 rename/delete 且没有文件锁。
- **GREEN**：实现显式 `open(path)`/`migrate()`/`close()`；路径由调用方注入，禁止模块级单例。K01 不接生产 Composition Root。
- **验证**：`bun test tests/sqlite-spike.test.ts`、`bun run spike:sqlite`、architecture、typecheck、build。
- **完成/删除**：Spike 报告新增 `app-database` 场景；不迁业务数据，不改 UI。

### K02 · SQLite SessionCatalogRepository

- **依赖**：K01。
- **行为**：创建、列出、更新、删除 Session 元数据都走 SQLite，排序与现有侧栏一致。
- **原型锚点**：`sessions` 的数据基础，无新增样式。
- **文件**：新建 `src/runtime/sessions/session-repository.ts`、`src/infrastructure/sqlite/repositories/sqlite-session-repository.ts`、`src/infrastructure/sqlite/migrations/002_app_sessions.sql`、对应单测；修改 Runtime dependency contract。
- **RED**：覆盖 create/list/update/delete、跨 reopen 保留、不同 Workspace 隔离和 `updatedAt` 排序。
- **GREEN**：实现最小 repository；不迁消息、不导入 JSONL。
- **验证**：repository 单测、architecture、typecheck、test。
- **完成/删除**：`src/main/session-store.ts` 的 metadata 写入停止新增功能。

### K03 · 会话侧栏切换到 SQLite

- **依赖**：K02。
- **行为**：在当前 App 新建会话后，侧栏立即显示；重启后仍能选中并读取元数据。
- **原型锚点**：`sessions`，先沿用现有骨架，不做最终视觉。
- **文件**：修改 `src/runtime/app/tgbuddy-runtime.ts`、`src/main/bootstrap/create-application.ts`、`src/main/bootstrap/create-legacy-runtime.ts`；新增 Runtime/Application integration test。IPC 和现有 `App.tsx` 消费方式保持不变。
- **RED**：Runtime create/list 使用 fake message backend 时，Session 跨 Runtime reopen 可见。
- **GREEN**：`createApplication()` 打开 `userData/tgbuddy.db`、创建 SQLite repository，并把 sessions dependency 注入/覆盖 compatibility adapter；application `dispose()` 先停止 Runtime，再关闭 repository/AppDatabase。保留现有 IPC contract。
- **验证**：integration test、build、`bun run dev` 新建并重启；退出后数据库无锁。
- **完成/删除**：`create-legacy-runtime.ts` 不再委托 session catalog。

### K04 · pi Session backend 适配器

- **依赖**：K01。
- **行为**：给定 Session ID，可创建、追加和恢复 pi Session entry，顺序与 ID 稳定。
- **原型锚点**：基础设施，无新增画面。
- **文件**：新建 `src/runtime/sessions/message-store.ts`、`src/kernel/pi/pi-session-store.ts`、对应单测；修改 Composition Root；把 `@earendil-works/pi-storage-sqlite-node@0.82.1` 从 devDependency 提升为生产 dependency。
- **RED**：覆盖 append/reopen、compaction entry、cleanup、两个 Session 隔离。
- **GREEN**：封装 `@earendil-works/pi-storage-sqlite-node`；Composition Root 只把与 AppDatabase 相同的 `tgbuddy.db` 物理路径交给 backend，由 backend 使用独立连接和自身 migration；不把 pi 私有表泄漏给 Runtime，也不通过 AppDatabase 查询它们。
- **验证**：单测、`bun run spike:sqlite`、probe、architecture。
- **完成/删除**：生产路径不直接拼 pi backend SQL。

### K05 · 消息历史切换到 pi Session backend

- **依赖**：K03、K04。
- **行为**：用户/assistant/tool 消息落库后，当前对话和重启回放显示一致内容。
- **原型锚点**：`main` 时间线。
- **文件**：修改 Runtime Session commands、`src/main/bootstrap/create-application.ts`、`src/renderer/App.tsx`；新增消息 integration test。
- **RED**：发送模拟消息、重建 Runtime、调用 `sessions.messages()`，断言信封、角色、顺序和 `kernel` 护栏一致。
- **GREEN**：把现有 `SessionMessage` 与 pi entry 边界集中在适配器；不增加第二套消息格式。
- **验证**：integration test、probe、build、dev 重启回放。
- **完成/删除**：新消息不再写 JSONL。

### K06 · legacy JSONL 一次性导入

- **依赖**：K02、K04、K05。
- **行为**：首次启动发现 legacy 数据时幂等导入；坏行不阻塞启动，并产生可诊断结果。
- **原型锚点**：`sessions`；只增加一次性系统诊断，不做迁移向导。
- **文件**：把 `scripts/sqlite-spike-import.ts` 的已验证纯逻辑迁入 `src/infrastructure/sqlite/legacy-importer.ts`；新增 importer integration test；修改 Composition Root。
- **RED**：fixture 首次导入、二次启动、坏行、冲突 ID、半成品恢复。
- **GREEN**：复用 Spike 的 fingerprint/diagnostic 语义；成功后写 migration marker，绝不双写。
- **验证**：import test、`bun run spike:sqlite`、build。
- **完成/删除**：JSONL 变为 import/export/audit 格式，不再 canonical。

### K07 · RunRegistry 单会话单飞

- **依赖**：K03。
- **行为**：同一 Session 同时只能有一个 active Run；不同 Session 可以并行。
- **原型锚点**：基础设施；沿用现有发送按钮禁用态。
- **文件**：新建 `src/runtime/runs/run-registry.ts`、`src/runtime/runs/run-coordinator.ts`、单测；扩充 Run contract。
- **RED**：覆盖同 Session 重入拒绝、跨 Session 并行、settled 后释放、dispose 清理。
- **GREEN**：Run 状态归 Runtime 持有，不使用 Main 模块级 Map。
- **验证**：`tests/agent-concurrency.test.ts` 迁移/扩充、architecture、typecheck。
- **完成/删除**：不接真实 pi，只完成生命周期锁。

### K08 · PiAgentEngine 文本流

- **依赖**：K05、K07。
- **行为**：发送一条消息后，pi engine 通过 Runtime 事件流式返回 thinking/text/message_end。
- **原型锚点**：`main`。
- **文件**：新建 `src/runtime/runs/agent-engine.ts`、`src/kernel/pi/pi-agent-engine.ts`；修改 RunCoordinator、Composition Root；新增 fake-engine integration test。
- **RED**：fake engine 发出分片，断言 Runtime frame 的 `sessionId/runId/channel` 和顺序。
- **GREEN**：pi 调用只放 `src/kernel/pi/**`；Runtime 只依赖 `AgentEngine` port。
- **验证**：integration test、probe、build、dev 实发一轮。
- **完成/删除**：`src/main/orchestrator.ts` 不再拥有新 Run 入口。

### K09 · Run settled、消息落盘与失败状态

- **依赖**：K08。
- **行为**：成功或失败都进入 settled；完整消息先落盘再更新 Session 状态，错误在时间线和侧栏可见。
- **原型锚点**：`main`、`sessions`。
- **文件**：修改 RunCoordinator、SessionRepository、Runtime events、`useGlobalAgentListeners.ts`；新增 settled integration test。
- **RED**：覆盖 success、pi error event、落盘失败、engine throw 兼容、重复 settled。
- **GREEN**：统一 settled 顺序；失败状态持久化，host error 可恢复。
- **验证**：integration test、probe、build、dev 模拟无效 key。
- **完成/删除**：禁止“stream 永不 throw”假设导致静默失败。

### K10 · Stop、级联 Abort 与迟到事件丢弃

- **依赖**：K09。
- **行为**：点击停止后 engine 收到 Abort；Run settled；迟到的旧 run frame 不污染新 run。
- **原型锚点**：`main` 停止按钮。
- **文件**：修改 RunRegistry、RunCoordinator、PiAgentEngine、`useGlobalAgentListeners.ts`；扩充并发测试。
- **RED**：stop 后模拟迟到 text/message_end，再启动新 run，断言 UI state 只接受新 `runId`。
- **GREEN**：AbortController 归 RunRegistry；保留 renderer `acceptRunFrame` 第二道防线。
- **验证**：并发测试、probe、build、dev 人工停止。
- **完成/删除**：停止不留下 running Session 或挂起请求。

### K11 · 工具调用四态闭环

- **依赖**：K09；PolicyEngine port 先用显式 permissive fake，S05 再接真实决策。
- **行为**：tool start、权限等待、running、success/error 按原型四态展示并可回放。
- **原型锚点**：`tools`；保留 120ms 重排。
- **文件**：修改 PiAgentEngine tool event mapping、RunCoordinator、`ToolCard.tsx`、listener；新增工具事件测试。
- **RED**：覆盖授权在 120ms 内到达、成功、失败、停止导致 unknown、历史回放。
- **GREEN**：事件只传 contract；卡片结构与状态分离，长输出暂只做 8 行预览。
- **验证**：timer test、probe、build、dev 四态场景。
- **完成/删除**：不在此 Slice 做持久权限规则或 Blob。

### K12 · 重启恢复未完成 Run

- **依赖**：K09、K10。
- **行为**：应用重启时把遗留 running Session 标记为 interrupted，历史仍可读并能继续发送。
- **原型锚点**：`sessions` 失败/中断副标题、`main` 系统标记。
- **文件**：修改 RunCoordinator bootstrap、SessionRepository；新增 crash-recovery integration test；最小修改 Renderer marker。
- **RED**：预置 running 元数据后重建 Runtime，断言状态变 interrupted、没有 active controller、下一 run 可启动。
- **GREEN**：bootstrap recovery 幂等；不伪造 assistant 结尾。
- **验证**：integration test、`bun run spike:sqlite`、build、dev 强退重启。
- **完成/删除**：恢复逻辑不依赖 Renderer 是否打开。

### K13 · 手动压缩闭环

- **依赖**：K05、K09。
- **行为**：用户点击压缩，原始消息保留，新的 compaction entry 生效，完成后可展开查看被压缩消息。
- **原型锚点**：`context`。
- **文件**：新建 `src/runtime/context/context-service.ts`；迁移 `src/kernel/compaction.ts` 到 `src/kernel/pi/`；修改 Runtime/Renderer 现有压缩组件；新增 context test。
- **RED**：覆盖 start、成功、失败、取消、恢复后的 buildContext。
- **GREEN**：压缩由 Runtime 编排、pi adapter 执行、MessageStore 持久化。
- **验证**：compaction test、`probe:compaction`、build、dev。
- **完成/删除**：`src/main/compaction-service.ts` 不再拥有手动压缩。

### K14 · 85% 自动压缩与 3 秒稍后

- **依赖**：K13。
- **行为**：上下文达到 85% 后显示 3 秒提示；可“稍后”；运行中则排队；压缩期间输入可排队但不锁死。
- **原型锚点**：`context`。
- **文件**：修改 ContextService、RunCoordinator、context events、现有 compaction UI/listener；扩充 context test。
- **RED**：fake clock 覆盖 84/85%、defer、running queue、queued prompt、压缩完成立即 flush。
- **GREEN**：阈值与延迟为领域常量；保持现有“先释放锁再通知 UI”顺序。
- **验证**：fake-timer tests、probe:compaction、build、dev。
- **完成/删除**：删除旧 Main compaction owner。

### K15 · 编辑并重发的线性截断

- **依赖**：K05、K10。
- **行为**：对历史用户消息“编辑并重发”时，从该点做可审计截断并启动新 run，不创建分支。
- **原型锚点**：`sessions` 线性历史决定。
- **文件**：扩充 MessageStore/Session commands/IPC；在 MessageView 增加最小菜单；新增 truncate integration test。
- **RED**：覆盖截断边界、撤销审计保留、重启后 active history、截断后新消息。
- **GREEN**：只追加 truncate 语义，不物理删除旧 entry。
- **验证**：integration test、build、dev。
- **完成/删除**：不实现 tree/fork UI。

### K16 · 从此新建扁平 Session

- **依赖**：K15。
- **行为**：选择历史消息“从此新建会话”，复制此前 active history 到新 Session，并在侧栏选中新会话。
- **原型锚点**：`sessions`。
- **文件**：扩充 SessionService/MessageStore/IPC/MessageView；新增 clone-prefix test。
- **RED**：断言新 ID、消息前缀、原会话不变、无共享可变状态、重启可恢复。
- **GREEN**：实现扁平复制，不暴露 pi tree。
- **验证**：integration test、build、dev。
- **完成/删除**：不实现分支图和时间旅行。

### K17 · Session/Run legacy owner 收口

- **依赖**：K06、K14、K16。
- **行为**：删除已经迁完的 JSONL canonical、旧 orchestrator 和旧 compaction 委托，产品行为不变。
- **原型锚点**：无新增画面；M1 回归。
- **文件**：删除/收缩 `src/main/session-store.ts`、`src/main/orchestrator.ts`、`src/main/compaction-service.ts`、相关旧 kernel 文件和 compatibility re-export；更新 checker 豁免。
- **RED**：先把 architecture test 改为这些旧 owner/依赖必须不存在。
- **GREEN**：Composition Root 只装配新 Runtime、pi 和 SQLite adapter。
- **验证**：全部 gate、SQLite spike、两个 probe、dev 演示 M1。
- **完成/删除**：M1 结束后不得再有 Main 持有的业务生命周期。

## 3. M2 · Workspace 与安全

### S01 · Workspace catalog 与选择器

- **依赖**：K17、R02。
- **行为**：添加本地目录成为逻辑 Workspace；切换后只显示该 Workspace 的 Session。
- **原型锚点**：`main` 顶部 Workspace 选择器、`empty`。
- **文件**：新建 WorkspaceRepository/Service/SQLite repo；扩充 IPC；替换 App 侧栏顶部占位；新增 test。
- **RED**：create/list/select、同路径去重、Session 隔离。
- **GREEN**：Workspace ID 与路径分离，选择状态由 Runtime/Renderer 显式持有。
- **验证**：test、build、dev 选择两个目录。
- **完成/删除**：不在此 Slice 执行文件工具。

### S02 · Workspace mount 可用性

- **依赖**：S01。
- **行为**：目录缺失/不可访问时 Workspace 仍在 catalog，但新 run 被阻止并给出恢复动作。
- **原型锚点**：`empty`/`main` host error。
- **文件**：新建 WorkspaceMount port、Node adapter；修改 WorkspaceService/App；新增 test。
- **RED**：覆盖存在、丢失、文件冒充目录、恢复后可用。
- **GREEN**：每次 run 前 resolve mount，不缓存永远有效的路径。
- **验证**：test、build、dev 临时改名目录。
- **完成/删除**：错误必须可见，不默默回退 cwd。

### S03 · per-run ExecutionEnv 基础隔离

- **依赖**：S02。
- **行为**：每个 Run 得到独立 ExecutionEnv，read/write 只能使用当前 Workspace mount。
- **原型锚点**：基础设施；工具卡显示相对路径。
- **文件**：新建 Runtime `execution-env` port、Node adapter；迁移 sandboxed env；新增隔离 test。
- **RED**：两个 Workspace 并行 read/write 不串目录，run settled 后 env 释放。
- **GREEN**：沙箱放 Env 层，不逐个工具复制路径规则。
- **验证**：permission-control-tools test、probe、architecture。
- **完成/删除**：不处理 bash 静态解析。

### S04 · canonical path 与逃逸拒绝

- **依赖**：S03。
- **行为**：`..`、symlink/junction 逃逸和绝对外部路径被拒绝，错误在工具卡可见。
- **原型锚点**：`tools` 失败态。
- **文件**：修改 Node ExecutionEnv/path helper、Tool error mapping、测试。
- **RED**：覆盖 `..`、绝对路径、symlink/junction、大小写、合法子路径。
- **GREEN**：resolve + realpath/canonical containment；不存在目标按最近已存在父目录判断。
- **验证**：Windows path tests、probe、dev。
- **完成/删除**：拒绝不依赖 Renderer。

### S05 · PolicyEngine 基础决策

- **依赖**：S03。
- **行为**：每次工具调用得到 allow/ask/deny；默认读允许，写与命令询问。
- **原型锚点**：`perm`、`settings/tools`。
- **文件**：新建 PolicyEngine、PermissionRuleRepository port、测试；PiAgentEngine preflight 接 port。
- **RED**：按 tool + match + expiry 覆盖 allow/ask/deny，deny 不执行工具。
- **GREEN**：决策纯函数化，运行状态不放 Main。
- **验证**：permission tests、probe。
- **完成/删除**：先用内存 rule repo，不做持久化 UI。

### S06 · inline 权限队列与重载恢复

- **依赖**：S05。
- **行为**：ask 决策产生 inline 卡片；回应后执行/拒绝；Renderer 重载后挂起请求仍在。
- **原型锚点**：`perm` 默认 inline。
- **文件**：修改 Runtime permission commands/events、listener、PermissionBanner；迁移 pending-request tests。
- **RED**：先订阅/后快照竞态、允许、拒绝、stop 清理、session 隔离。
- **GREEN**：请求由 Runtime registry 持有；IPC 只响应 request ID。
- **验证**：pending/permission tests、build、dev。
- **完成/删除**：旧 Main pending service 不再接新请求。

### S07 · “总是允许”规则持久化

- **依赖**：S05、S06。
- **行为**：用户选择工具×范围×有效期后，后续匹配调用自动允许；过期或不匹配仍询问。
- **原型锚点**：`perm`、`settings/rules`。
- **文件**：实现 SQLite PermissionRuleRepository；扩充 PermissionBanner 和最小规则列表；新增 test。
- **RED**：path glob、command prefix、MCP method、session/workspace/permanent expiry、reopen。
- **GREEN**：规则记录 reason/source；匹配逻辑仍在 PolicyEngine。
- **验证**：test、build、dev 重启。
- **完成/删除**：不把工具 `details` 当匹配事实。

### S08 · 高危不可逆模态与 neverPersist

- **依赖**：S07。
- **行为**：高危不可逆命令升级模态；含 `rm`/`sudo` 等规则只能本次允许，不能持久化。
- **原型锚点**：`perm` 模态与顶部等待队列。
- **文件**：扩充 risk classifier/permission contract；新增模态组件；修改 listener；新增 test。
- **RED**：覆盖 modal 条件、neverPersist、普通 ask 仍 inline、多个 Session 等待提示。
- **GREEN**：风险分类来自 Tool call 输入；“总是允许”控件在 neverPersist 时禁用并解释。
- **验证**：test、build、dev 原型危险场景。
- **完成/删除**：bash 继续以授权作为实际防线。

### S09 · Plan 模式

- **依赖**：S06。
- **行为**：切到 Plan 后先生成计划并等待审批；批准后才执行写/命令工具，拒绝则 settled。
- **原型锚点**：`main` 输入区模式 Chip。
- **文件**：迁移 PlanService 到 Runtime、pi plan tool adapter、现有 PlanApproval；新增 test。
- **RED**：mode change 持久化、approve/reject、stop、reload pending。
- **GREEN**：模式是 Session 元数据；计划请求走统一 pending registry。
- **验证**：plan-mode tests、probe、build、dev。
- **完成/删除**：删除旧 Main plan owner。

### S10 · ask_user 结构化提问

- **依赖**：S06。
- **行为**：Agent 可发 1–3 个结构化问题；回答回到原 Run；重载和取消不丢状态。
- **原型锚点**：`main` inline question card。
- **文件**：迁移 AskUserService/tool 到 Runtime/pi adapter；复用 AskUserCard；新增 test。
- **RED**：schema、response、reload、stop、过期 request。
- **GREEN**：和 permission/plan 共用 registry 机制但保持独立 contract。
- **验证**：ask-user tests、probe、build、dev。
- **完成/删除**：删除旧 Main ask-user owner。

### S11 · 安全 legacy owner 收口

- **依赖**：S04、S08、S09、S10。
- **行为**：删除旧 Main permission/plan/ask-user/sandbox owner，全部安全决策从 Runtime + Env 执行。
- **原型锚点**：M2 全场景回归。
- **文件**：删除旧 service/tool 文件、compat re-export，更新 checker 和文档。
- **RED**：architecture test 先要求旧 owner 不可 import。
- **GREEN**：Composition Root 装配 PolicyEngine、rule repo、ExecutionEnv factory。
- **验证**：全部 gate、probe、build、dev M2 演示。
- **完成/删除**：Main 仅保留 Electron host 与 adapter。

## 4. M3 · Tool、Skill、MCP 通用能力系统

### C01 · SecretStore

- **依赖**：S11。
- **行为**：API key/token 只通过 SecretStore 保存与读取，SQLite 只存 secret reference。
- **原型锚点**：`settings/model`。
- **文件**：新建 SecretStore port、OS adapter、fake adapter、测试。
- **RED**：set/get/delete、缺失、重启、序列化结果不含明文。
- **GREEN**：Composition Root 注入；测试不触碰真实系统凭据。
- **验证**：test、architecture、typecheck。
- **完成/删除**：`.env` 只保留开发兼容，不成为设置存储。

### C02 · Channel CRUD 与设置页

- **依赖**：C01。
- **行为**：新增/编辑/删除 Provider Channel，密钥以 secret ref 保存，设置页即时刷新。
- **原型锚点**：`settings/model`。
- **文件**：新建 ChannelRepository/Service/SQLite repo；扩充 IPC；拆出最小 `settings/model` feature；新增 test。
- **RED**：CRUD、secret ref、删除被 Session 引用时拒绝。
- **GREEN**：迁移现有 channel preset，不再写 JSON。
- **验证**：test、build、dev。
- **完成/删除**：旧 `channel-store.ts` 停止写入。

### C03 · Channel 连通性与模型发现

- **依赖**：C02。
- **行为**：设置页可测试连接并刷新模型列表，失败显示可操作诊断。
- **原型锚点**：`settings/model` 状态。
- **文件**：新建 ProviderCatalog port/pi adapter；扩充 Settings commands/UI；新增 test。
- **RED**：成功、认证失败、超时、空模型、取消。
- **GREEN**：测试调用不创建 Session/Run；错误映射为稳定 contract。
- **验证**：fake adapter test、build、dev 使用真实测试渠道。
- **完成/删除**：不在 Renderer 请求 provider。

### C04 · Profile 与输入区模型选择

- **依赖**：C03。
- **行为**：Session 选择 Profile/模型后，下一 Run 使用该不可变快照；历史 Run 不受设置变更影响。
- **原型锚点**：`main` 输入区 chips、`settings/model`。
- **文件**：新建 ProfileRepository/Service/SQLite repo；扩充 Session contract、input chips；新增 test。
- **RED**：默认 profile、session override、设置变更后旧 Run snapshot 不变。
- **GREEN**：Run 启动时固化 channel/model/system prompt。
- **验证**：test、probe、build、dev。
- **完成/删除**：禁止 Run 中途读全局 mutable settings。

### C05 · ToolRegistry 与内置工具快照

- **依赖**：S11、C04。
- **行为**：当前 Workspace/Profile 解析出稳定工具列表，并在 Run 启动时冻结。
- **原型锚点**：`settings/tools`。
- **文件**：新建 ToolRegistry、builtin adapter；迁移旧 tools index；新增 test。
- **RED**：同名冲突、enable/disable、顺序稳定、snapshot 不随运行中设置变化。
- **GREEN**：read/write/bash/plan/ask_user 通过统一 descriptor 注册。
- **验证**：test、probe。
- **完成/删除**：不实现 Skill/MCP。

### C06 · 工具三档权限设置

- **依赖**：C05、S07。
- **行为**：设置页每个工具可选允许/询问/禁止，下一 Run 的 PolicyEngine 使用新值。
- **原型锚点**：`settings/tools`。
- **文件**：扩充 Tool settings repository/Runtime commands；实现 tools feature UI；新增 test。
- **RED**：批量改询问、恢复推荐、单工具覆盖、disabled tool。
- **GREEN**：UI 数值从原型提取；工具结构与权限状态分离。
- **验证**：test、build、dev。
- **完成/删除**：不把 UI setting 直接写进 Tool 实例。

### C07 · Skill manifest 发现与设置列表

- **依赖**：S01、C05。
- **行为**：发现内置、用户级、Workspace 级 Skill manifest，按来源分组；Workspace 切换后刷新。
- **原型锚点**：`settings/skills`。
- **文件**：新建 SkillCatalog port、filesystem adapter、manifest parser；实现 skills list UI；新增 test fixtures。
- **RED**：来源优先级、重复名、坏 manifest、路径切换、禁用。
- **GREEN**：列表阶段只读 metadata，不加载正文。
- **验证**：test、build、dev 放入 fixture Skill。
- **完成/删除**：不执行 Skill。

### C08 · Skill 正文按调用加载

- **依赖**：C07、C04。
- **行为**：Run snapshot 只带 Skill 摘要；Agent 选择 Skill 时按需读取正文和被引用资源，越界引用被拒绝。
- **原型锚点**：`settings/skills` 启用态、`main` 运行结果。
- **文件**：新建 SkillLoader port/adapter、pi skill tool；扩充 CapabilitySnapshot；新增 test。
- **RED**：按需加载、relative resource、越界、正文修改只影响下一 Run、token 统计。
- **GREEN**：Skill 内容不常驻全局 prompt；读取经 Workspace/Skill root 安全边界。
- **验证**：test、probe、dev 触发一个 Skill。
- **完成/删除**：不加入第三方插件 ABI。

### C09 · MCP 配置、连接与状态卡

- **依赖**：C01、C02。
- **行为**：保存 stdio/http MCP 配置后可连接、断开、重连；设置页显示状态和错误。
- **原型锚点**：`settings/mcp`。
- **文件**：新建 McpConfigRepository、McpTransport port/adapter、McpManager；实现 MCP service card；新增 fake transport test。
- **RED**：connect/disconnect/timeout/restart/disabled/secret substitution。
- **GREEN**：Runtime 管连接状态；Main 只提供进程/网络 host adapter。
- **验证**：test、build、dev 连接一个测试 MCP。
- **完成/删除**：此 Slice 不把 MCP tool 注入 Run。

### C10 · MCP tool 发现与能力快照

- **依赖**：C05、C06、C09。
- **行为**：已连接 MCP 的 tools 进入 ToolRegistry；断开后只从下一 Run 的工具快照移除。
- **原型锚点**：`settings/mcp` 展开的工具列表。
- **文件**：扩充 McpManager、ToolRegistry、MCP UI；新增 discovery integration test。
- **RED**：discover、同名冲突、schema 变化、server disconnect、重连后下一 Run 更新、当前 Run 不突变。
- **GREEN**：MCP tool descriptor 使用稳定 `server.method` 名称并进入冻结 snapshot。
- **验证**：integration test、probe、build、dev。
- **完成/删除**：此 Slice 不执行 MCP tool。

### C11 · MCP tool 权限与调用

- **依赖**：C06、C10。
- **行为**：Agent 调用 MCP tool 时按 server.method 走 allow/ask/deny，成功/失败/断线显示真实工具卡与 host error。
- **原型锚点**：`tools`、`perm`、`settings/mcp`。
- **文件**：扩充 McpManager call、PolicyEngine matcher、PiAgentEngine mapping、MCP status UI；新增 call integration test。
- **RED**：success、deny、ask、timeout、disconnect、取消和结构化错误。
- **GREEN**：调用只使用当前 Run snapshot；断线不伪造成功。
- **验证**：integration test、probe、build、dev。
- **完成/删除**：长输出暂留普通预览，A04 再 Blob 化。

### C12 · CapabilitySnapshot 与 token 账本

- **依赖**：C04、C05、C08、C11。
- **行为**：每个 Run 持久化所用 Profile、模型、Tool、Skill、MCP 版本快照和分类 token/cost。
- **原型锚点**：`context` 使用量、系统标记。
- **文件**：扩充 Run contract/repository/RunCoordinator/ContextUsagePanel；新增 snapshot test。
- **RED**：设置变更不改历史 snapshot；token 分类相加；失败 Run 也有已知账本。
- **GREEN**：settled 时一次提交快照摘要；敏感配置只存 ref/hash。
- **验证**：test、probe、build、dev。
- **完成/删除**：M3 全 gate；删除旧 Main channel/tools owner。

## 5. M4 · Blob、附件与结果

### A01 · 内容寻址 BlobStore

- **依赖**：C12。
- **行为**：相同内容只存一份，读回校验 hash，临时写失败不留下半文件。
- **原型锚点**：基础设施。
- **文件**：新建 BlobStore port、filesystem adapter、测试。
- **RED**：put/get/dedupe/hash mismatch/atomic write/missing。
- **GREEN**：SQLite 只存 ref；Blob 路径由 hash 派生。
- **验证**：test、architecture。
- **完成/删除**：不接附件和工具。

### A02 · 附件选择、预览与持久化

- **依赖**：A01、S01。
- **行为**：输入区选择文件后显示 chip/预览，发送前先落 Blob；取消不发给模型。
- **原型锚点**：`main` 输入区附件 chip。
- **文件**：扩充 attachment contract/IPC/Preload；新增 input attachment feature；修改 Runtime SessionService；新增 test。
- **RED**：选择、重复文件、取消、缺失、超限。
- **GREEN**：Renderer 只拿 metadata/ref，不拿 Node path API。
- **验证**：test、build、dev。
- **完成/删除**：此 Slice 不做模型 multimodal 转换。

### A03 · 附件进入模型上下文

- **依赖**：A02、C04。
- **行为**：支持的图片/文本附件进入下一模型调用；重启回放后可再次构造相同上下文。
- **原型锚点**：`main`。
- **文件**：扩充 PiAgentEngine content adapter/MessageStore/attachment tests。
- **RED**：text/image、unsupported mime、missing blob、replay、provider capability mismatch。
- **GREEN**：按 provider capability 转换，原始 ref 保留。
- **验证**：test、probe、dev。
- **完成/删除**：不在消息表内嵌大 base64。

### A04 · 长工具输出 Blob 化

- **依赖**：A01、K11、C11。
- **行为**：超过 256KB 的工具输出完整落 Blob；模型侧只收截断 preview（复用 pi `truncate*`，
  修正 docs/06 决定 2「完整版仍然送给模型」的表述），UI 只显示 8 行预览和“打开完整结果”。
- **原型锚点**：`tools`。
- **文件**：扩充 ToolResult contract/RunCoordinator/BlobStore/ToolCard；新增 threshold test。
- **RED**：阈值上下、UTF-8 边界、error output、MCP output、replay。
- **GREEN**：message 只保存 preview + blob ref + size/hash。
- **验证**：test、probe、build、dev。
- **完成/删除**：禁止依赖 pi tool `details` 形状。

### A05 · Artifact 投影

- **依赖**：A01、A04。
- **行为**：成功的产出型工具从调用参数投影 Artifact；失败或纯读工具不产生 Artifact；
  producer 记录 root/child 与来源技能（docs/06 决定 1 的「谁产生的」，D04 折叠组展示时使用）。
- **原型锚点**：`main` 结果区。
- **文件**：新建 ArtifactProjector/Repository/SQLite repo；修改 settled；新增 test。
- **RED**：write/edit/导出类工具、失败、同路径更新、跨 Session、重启。
- **GREEN**：从 tool args 推导，注册 producing capability；不读 `details`。
- **验证**：test、probe。
- **完成/删除**：替代旧 `countArtifacts` 推导。

### A06 · 结果列表、分组与筛选

- **依赖**：A05。
- **行为**：右侧结果按时间倒序，分“本次任务/更早”，支持类型筛选和选中态。
- **原型锚点**：`main`、`empty` 结果区。
- **文件**：扩充 artifact IPC/Preload；新增 renderer results feature；替换 App 结果占位；新增 state test。
- **RED**：排序、分组、筛选、空状态、Session 切换。
- **GREEN**：Runtime 返回可序列化 Artifact summary；样式直接抠原型。
- **验证**：test、build、dev。
- **完成/删除**：不编辑 Artifact。

### A07 · Artifact 只读预览与外部打开

- **依赖**：A06、S04。
- **行为**：选中 Artifact 显示只读预览，并可用系统默认应用外部打开。
- **原型锚点**：`main` 结果预览。
- **文件**：新增 ArtifactContentService/host open adapter/preview UI；扩充 IPC；新增 test。
- **RED**：文本预览、二进制 fallback、missing、路径逃逸、外部打开失败。
- **GREEN**：预览读取经安全 adapter；不在 UI 创建第二份可编辑真相。
- **验证**：test、build、dev。
- **完成/删除**：预览只读，不做内置 IDE。

### A08 · “让 Agent 改这份”入口

- **依赖**：A07。
- **行为**：点击“让 Agent 改这份”只把 Artifact 引用和目标意图注入输入区，用户确认发送后才启动 Run。
- **原型锚点**：`main` 结果预览。
- **文件**：修改 results feature/input state/App composition；新增 interaction state test。
- **RED**：注入相对路径/ref、保留用户已有草稿、取消、不自动发送、切换 Session 清理错误引用。
- **GREEN**：复用普通 send 流程，不创建 Artifact 专用执行入口。
- **验证**：test、build、dev。
- **完成/删除**：不允许预览区直接改文件。

### A09 · Blob 引用计数与恢复清理

- **依赖**：A03、A04、A05、A08。
- **行为**：删除 Session/Artifact 后只清理无引用 Blob；重启可修复孤儿临时文件和引用计数。
- **原型锚点**：基础设施；M4 回归。
- **文件**：新建 BlobRefRepository/CleanupService；接 Session delete；新增 recovery test。
- **RED**：共享 blob、删除一个引用、最后引用、crash temp、missing blob diagnostic。
- **GREEN**：先事务更新 ref，再延迟物理清理；失败可重试。
- **验证**：test、build、M4 全 gate。
- **完成/删除**：不做后台云同步。

## 6. M5 · 单层子 Agent

### D01 · Run lineage 与共享预算

- **依赖**：A09、C12。
- **行为**：父 Run 可创建一层 child descriptor，继承 Workspace/capability snapshot，并受总 token/成本/深度预算限制。
- **原型锚点**：`tools` 子智能体组的数据基础。
- **文件**：扩充 Run contract/repository；新建 DelegationPolicy；新增 test。
- **RED**：depth=1、预算不足、snapshot 继承、不同父隔离。
- **GREEN**：lineage 持久化；不实现 DAG/parallel router。
- **验证**：test、probe。
- **完成/删除**：child 还不执行。

### D02 · 同步 child run 与结果回传

- **依赖**：D01、K09。
- **行为**：父 Agent 调用 delegate tool 后运行一个 child，child settled 摘要作为 tool result 回到父 Run。
- **原型锚点**：`tools` 折叠组。
- **文件**：新建 DelegationService/pi delegate tool；扩充 RunCoordinator/events；新增 integration test。
- **RED**：success/error、父等待、child history、预算扣减。
- **GREEN**：复用同一 AgentEngine/RunCoordinator，不创建第二套运行时。
- **验证**：test、probe、dev。
- **完成/删除**：只做同步单层，不并行 fan-out。

### D03 · child 取消与权限继承

- **依赖**：D02、S08。
- **行为**：停止父 Run 级联停止 child；child 权限请求仍归父 Session 队列，但标明来源。
- **原型锚点**：`perm`、`tools`。
- **文件**：扩充 RunRegistry/PendingRegistry/permission contract；新增 test。
- **RED**：parent stop、child stop、pending cleanup、neverPersist、late event。
- **GREEN**：一个 Abort tree；权限策略继承 snapshot，不自动扩大。
- **验证**：test、probe、build。
- **完成/删除**：不允许 child 绕过父权限。

### D04 · 子 Agent 折叠组 UI

- **依赖**：D02、D03。
- **行为**：child 的工具与摘要收进一个可折叠组；父时间线默认只显示状态与最终摘要。
- **原型锚点**：`tools`。
- **文件**：扩充 events/listener atoms；新增 DelegationGroup；修改 MessageView；新增 renderer test。
- **RED**：running/success/error/cancel、展开顺序、Session 切换。
- **GREEN**：结构容器保持可识别，成功态不使用抢眼绿色。
- **验证**：test、build、dev、M5 全 gate。
- **完成/删除**：不做 Team 控制台。

## 7. M6 · 产品与原型收口

### U01 · 整窗空状态

- **依赖**：S01、A06。
- **行为**：无 Workspace/Session 时显示三个可点击任务样例、当前模式和结果区解释；点击样例填入输入。
- **原型锚点**：`empty`。
- **文件**：拆出 EmptyState feature；修改 App shell；新增 interaction test。
- **RED**：无 Workspace、无 Session、有 Session 三种切换，样例点击。
- **GREEN**：直接使用原型文案、间距和状态。
- **验证**：test、build、dev 截图核对。
- **完成/删除**：不使用通用欢迎页。

### U02 · 会话分组与搜索

- **依赖**：K16、S01。
- **行为**：会话按置顶/今天/7 天内/更早分组，搜索只过滤当前 Workspace 的 Session。
- **原型锚点**：`sessions`。
- **文件**：拆出 sessions list/view-model feature；修改 App composition；新增纯状态测试。
- **RED**：日期边界、置顶优先、搜索标题/摘要、Workspace 隔离、空结果。
- **GREEN**：只消费 SessionMeta，不为每行读取消息。
- **验证**：test、build、dev。
- **完成/删除**：此 Slice 不做菜单动作。

### U03 · 会话菜单动作

- **依赖**：U02、K16。
- **行为**：重命名、置顶、归档、删除以及线性历史两个动作从会话菜单执行。
- **原型锚点**：`sessions`。
- **文件**：扩充 Session commands/IPC；实现 sessions context menu；新增 interaction/integration test。
- **RED**：每个动作、running Session 删除保护、删除当前项后的选中回退。
- **GREEN**：菜单动作复用既有 SessionService，不在 Renderer 直接改列表。
- **验证**：test、build、dev。
- **完成/删除**：不做分支树。

### U04 · 设置 Shell 与各能力页收口

- **依赖**：C12。
- **行为**：设置导航中的模型与密钥、权限规则、工具、MCP、技能页面可访问，异常/询问角标正确。
- **原型锚点**：`settings`。
- **文件**：拆出 settings shell；组合 C02/C06/C07/C09 页面；新增 navigation test。
- **RED**：tab、关闭恢复、badge、Workspace 切换刷新 Skill。
- **GREEN**：未实现的通用/外观入口不伪装可用。
- **验证**：test、build、dev。
- **完成/删除**：删除 App.tsx 内临时设置逻辑。

### U05 · 主窗口与结果区视觉收口

- **依赖**：U01、U02、A08。
- **行为**：`empty` 与 `main` 两个场景的三栏、结果列表、预览、输入区和背景层级与原型一致。
- **原型锚点**：`empty`、`main`。
- **文件**：App shell、conversation/results/input feature styles；不改 Runtime 行为。
- **RED**：建立两个场景的 fixture/checklist；关键展开/收起交互加状态测试。
- **GREEN**：所有值从原型内联样式/ST 常量提取。
- **验证**：build、两个场景截图对照、键盘检查。
- **完成/删除**：删除临时三栏骨架和结果占位样式。

### U06 · 工具与权限视觉收口

- **依赖**：K11、S08、D04。
- **行为**：工具 pending/running/success/error/denied、子 Agent 组、inline 权限和高危模态与原型一致。
- **原型锚点**：`tools`、`perm`。
- **文件**：ToolCard、Permission components、DelegationGroup 和相关 styles。
- **RED**：为各状态建立 fixture/checklist；120ms 与折叠规则继续由自动测试守护。
- **GREEN**：成功态安静、异常态突出；结构容器不随状态消失。
- **验证**：build、两个场景截图对照、色弱可辨识检查。
- **完成/删除**：不改权限领域规则。

### U07 · 上下文、会话与设置视觉收口

- **依赖**：K14、U03、U04。
- **行为**：上下文压缩、会话列表、设置三个场景的布局、状态和导航与原型一致。
- **原型锚点**：`context`、`sessions`、`settings`。
- **文件**：Context components、sessions feature、settings shell/styles。
- **RED**：三个场景 fixture/checklist，导航与压缩展开状态测试。
- **GREEN**：直接抠原型数值；改 Tailwind 配置后重启 dev server。
- **验证**：build、三个场景截图对照、键盘检查。
- **完成/删除**：七个原型场景至此全部收口。

### U08 · IPC、Renderer feature 与 compatibility 收口

- **依赖**：U05、U06、U07。
- **行为**：不改变产品行为，把单一 IPC/总 atom/总 listener 拆为领域 owner，删除剩余 compatibility bridge。
- **原型锚点**：全部场景回归，无新增画面。
- **文件**：拆分 `src/main/ipc.ts`、renderer `features/*` event router；删除 `shared/types` re-export 和剩余 legacy owner；更新 architecture checker。
- **RED**：先增加负向 architecture test，要求领域 IPC 只依赖 Runtime public API，Renderer feature 不反向依赖 Main/Runtime。
- **GREEN**：逐 owner 搬迁，事件 router 只路由，不解释业务。
- **验证**：全部 unit/integration、architecture、typecheck、build、七场景 smoke。
- **完成/删除**：compatibility 豁免清零；若有外部阻塞项，必须逐项写新期限和证据。

### U09 · 7 条端到端验收与第一版收口

- **依赖**：U08。
- **行为**：`docs/02-功能范围.md:154-160` 的 7 条 E2E 在真实 Electron 中稳定通过。
- **原型锚点**：全部。
- **文件**：按 `$ship:e2e` 建立/扩充 E2E harness、fixtures、evidence；只修验收暴露的问题。
- **RED**：逐条先得到可解释失败：图片→报告→重启恢复；Workspace rebind；双 Session 隔离；>256KB 输出；MCP 断线；两个 child 后预算拒绝与级联取消；强杀后只恢复完整 `message_end`。
- **GREEN**：每条用用户可见断言，禁止只断内部 state。
- **验证**：E2E、全部 unit/integration、architecture、typecheck、build、SQLite spike、两个 probe。
- **完成/删除**：更新 README、AGENTS、docs 状态和第一版 evidence。

## 8. 每个 Slice 的开发模板

执行者创建 `.ship/tasks/<slice-id>/`，并按以下顺序：

1. 从本计划复制该 Slice 的行为、依赖、文件和验收。
2. 检查上游 ledger，不假设未交付 API。
3. 写 RED 测试并记录实际失败。
4. 只实现当前 Slice 的 GREEN。
5. 运行相关测试和固定 gate。
6. 有 UI 时启动真实 Electron，对照指定原型场景。
7. 更新 `dev-ledger.md`：文件、公开 API、删除项、验证命令、偏差。
8. 独立 commit 后继续下一 Slice；里程碑全部代码完成后、E2E 前集中 fresh peer review。

如果实现中发现 Slice 同时包含两个主要行为，停止扩张，把第二个行为追加为新的后续 Slice，而不是把当前任务做大。
