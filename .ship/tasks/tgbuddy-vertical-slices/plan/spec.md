# TgBuddy 通用智能体：内核优先的纵向切片规格

## 1. 目标

TgBuddy 是按用户自有功能设计打造的通用本地桌面智能体，核心能力包括 Agent Runtime、Tool、MCP、Skill、Workspace、权限、结果产物和可恢复会话。当前阶段先把内核做稳，但“内核优先”不等于“后端全部做完后再接前端”：每个研发任务都必须尽量形成一条可运行、可观察、可回归的最小纵向切片。

本规格替代“一个 Story 迁完整个大模块”的实施方式。已经完成的 Phase 0 和 Story 1A 保留；后续工作改为小 Slice：

- 一个 Slice 只交付一个主要行为；
- 默认应能在半天到一天半内完成，超过时必须继续拆分；
- 默认改动不超过 6 个生产文件；超过时在开工前说明不能再拆的原因；
- 每个 Slice 有独立 RED 测试、GREEN 验证和人工可见证据；
- 涉及用户行为时，同一个 Slice 同时完成 Runtime/IPC/Renderer 的最小接线；
- 不为未来模块预建空接口、空目录或无消费者抽象。

## 2. 产品事实来源

优先级固定如下：

1. `tgbuddy-mockup/TgBuddy 交互原型.dc.html`：当前 UI、信息结构和交互行为事实来源。
2. `docs/06-设计决策.md`：已经确定的行为约束，不在实施中重开讨论。
3. `docs/02-功能范围.md`：第一版功能边界与 7 条端到端验收。
4. `docs/01-架构设计.md`：领域模型、存储、安全和运行时设计。
5. `docs/07-代码仓库设计.md`：代码归属和依赖红线。
6. 当前代码与回归测试：迁移期间的实际兼容基线。

没有编码进原型或设计文档的产品行为，不凭其他产品印象补齐；新能力先进入用户自己的功能设计，再进入实施计划。

## 3. 当前证据

### 3.1 已完成的基座

- `package.json:16-22` 已提供 packaged SQLite Spike、probe、test、architecture、typecheck 和 build gate。
- `.ship/tasks/sqlite-packaged-electron-spike/plan/spec.md:7-19` 已验证 packaged Electron、pi SQLite backend、崩溃恢复、WAL 备份和 legacy JSONL 导入策略。
- `src/runtime/app/tgbuddy-runtime.ts:23-91` 已有 Workspace、Session、Run、Permission、Plan、Question、Context、Artifact、Capability、Settings 与订阅门面。
- `src/runtime/app/tgbuddy-runtime.ts:137-212` 已把组合行为收口在 Runtime，并支持幂等 `dispose()`。
- `src/main/bootstrap/create-legacy-runtime.ts:16-72` 仍把 Runtime 委托到旧 Main store/service，是后续渐进迁移的兼容桥。
- `src/main/ipc.ts:16-157` 已经只经 `TgBuddyRuntime` 暴露 IPC。

因此后续不需要再造第二个门面，也不需要大爆炸式重写；应按 Slice 逐项替换 `create-legacy-runtime.ts` 中的委托。

### 3.2 当前已经存在的 UI 消费者

- `src/renderer/App.tsx:62-90` 已消费 session list/create/messages/send，可直接作为 SQLite Session 切片的可见验证面。
- `src/renderer/App.tsx:93-148` 已有会话侧栏骨架。
- `src/renderer/App.tsx:151-227` 已有消息、流式文本、工具、权限、计划、提问和错误的时间线。
- `src/renderer/App.tsx:229-279` 已有模式、上下文、发送、停止和压缩期间排队入口。
- `src/renderer/App.tsx:282-287` 的结果区仍是占位，必须随着 Artifact Slice 逐步替换，不能一直拖到最后。
- `src/renderer/hooks/useGlobalAgentListeners.ts:101-215` 已接 agent/host 事件和挂起请求。
- `src/renderer/hooks/useGlobalAgentListeners.ts:232-280` 已接压缩排队、开始、完成和取消。
- `src/renderer/hooks/useGlobalAgentListeners.ts:306-337` 已实现“先订阅，再恢复挂起快照”的重载竞态保护。

因此“后端先做完再做 UI”既没有必要，也会让真实契约直到最后才暴露问题。

### 3.3 原型必须落到任务中的场景

原型在 `tgbuddy-mockup/TgBuddy 交互原型.dc.html:1269-1270` 定义 7 个验收场景：

1. `empty`：整窗空状态；
2. `main`：三栏主窗口；
3. `tools`：工具卡片四态；
4. `perm`：权限确认；
5. `context`：上下文与压缩；
6. `sessions`：线性会话列表；
7. `settings`：工具、MCP、技能设置。

行为约束位于同文件 `1274-1280`：

- 空状态有可点击任务样例；
- 结果区按时间倒序，并区分“本次任务 / 更早”；
- 工具卡片必须有等待授权、执行中、成功、失败四态；
- 高危不可逆操作才升级为模态，危险命令永不持久化授权；
- 85% 自动压缩，触发前 3 秒可稍后，输入不锁；
- 会话保持线性，只提供编辑重发和从此新建会话；
- 设置拆为工具、MCP、技能等页面。

每个相关 Slice 的验收必须引用其中一个场景；视觉数值直接从原型源码提取。

## 4. 实施原则

### 4.1 内核优先，但始终保留可运行产品

实施顺序以存储、Run、Workspace/安全、Blob/Artifact、能力系统、delegation 为主轴。每条主轴都使用以下闭环：

```text
领域契约 / Runtime 用例
  -> 真实 adapter
  -> typed IPC（若用户可见）
  -> 原型中的最小 UI 消费者
  -> 自动测试 + 运行时证据
```

纯基础设施 Slice 可以没有新 UI，但必须被下一个 Slice 立即消费；连续两个纯基础设施 Slice 之后，必须出现一个可运行集成 Slice。

### 4.2 兼容迁移，不做大爆炸替换

- app 数据与 pi Session backend 共用物理文件 `userData/tgbuddy.db`，但使用独立连接和迁移协议；TgBuddy 只管理 `app_schema_migrations` 与 `app_*` 表，绝不读取或依赖 pi 私表。
- 现有 JSONL、orchestrator、permission、compaction 和 renderer 总 atom 继续作为迁移桥。
- 新能力不能继续写进旧 owner；旧 owner 只能委托。
- 每迁走一个行为，立刻删除对应旧实现或缩窄兼容层。
- 任何 Slice 完成后，`bun run dev` 的已有会话循环仍应可用。

### 4.3 任务尺寸护栏

一个 Slice 同时出现以下任意两项时，必须再拆：

- 两个以上独立用户流程；
- 两个以上持久化聚合；
- 新增 IPC 命令和新建完整页面同时发生；
- 需要修改超过 6 个生产文件；
- RED 测试无法用一句行为描述命名；
- 验收必须依赖尚未实现的下一 Slice。

### 4.4 每个 Slice 的完成定义

每个 Slice 都必须包含：

1. **行为句**：`当……时，系统……`。
2. **原型锚点**：无 UI 时明确写“基础设施，无新增画面”。
3. **RED**：先写一个能稳定失败的测试或 probe。
4. **GREEN**：只实现该行为所需最小代码。
5. **自动验证**：相关测试 + architecture + typecheck；涉及打包/runtime 再加 build/probe。
6. **人工验证**：一个不依赖下一 Slice 的操作步骤和预期画面/日志。
7. **删除项**：本 Slice 替代了什么旧 owner。
8. **证据**：记录在对应 `.ship/tasks/<slice>/dev-ledger.md`。

## 5. 范围与非目标

### 第一版必须完成

- SQLite canonical app data 与 pi Session backend；
- 可恢复的单会话 Agent run、stop、error、tool、compaction；
- 逻辑 Workspace、per-run ExecutionEnv 和权限策略；
- Blob、附件、长输出和 Artifact 结果区；
- Channel、Profile、Tool、Skill、MCP；
- 单层 child delegation；
- 原型 7 个场景和 `docs/02-功能范围.md:152-160` 的 7 条端到端验收。

### 第一版不做

- Chat 模式；
- 分支会话、时间旅行和任务 DAG；
- 第三方插件 ABI、插件市场；
- 云端多租户与远程协作；
- 无 UI/Runtime 消费者的“平台化”抽象；
- 为追求目录整齐而一次性搬完所有文件。

## 6. 里程碑

| 里程碑 | 可演示结果 | 对应原型 |
|---|---|---|
| M1 可恢复对话内核 | 新建会话、发送、流式、停止、重启恢复、压缩 | main、tools、context、sessions |
| M2 Workspace 与安全 | 选择工作区、隔离读写、授权、高危确认、计划模式 | main、perm、settings |
| M3 附件与结果 | 附件入模、长输出落 Blob、结果列表和只读预览 | main、empty |
| M4 能力配置 | Channel/Profile/Tool/Skill/MCP 可配置并进入下一 Run | settings |
| M5 子 Agent | 单层 child 可运行、取消、继承权限并折叠展示 | tools |
| M6 第一版验收 | 7 个原型场景和 7 条 E2E 全部通过 | 全部 |

## 7. 验收

计划本身满足以下条件才可交给 `$ship:dev`：

1. 后续不再使用 Story 1B–6 作为开发单位，而只把它们作为历史迁移分组。
2. 每个 Slice 只有一个主要行为，并标明依赖、文件、RED、GREEN、验证与原型锚点。
3. M1–M5 每个里程碑都有真实 Renderer 集成点，不把前端集中到 M6。
4. 下一步明确为最小的 SQLite bootstrap Slice，不重做已完成的基座。
5. 计划覆盖原型 7 个场景和范围文档 7 条 E2E。
6. 计划明确何时删除每个 legacy owner。
7. 一名未参与编写的 Agent 能按计划选取任一 Slice，指出准确文件、命令和完成证据，无需猜测架构决策。
