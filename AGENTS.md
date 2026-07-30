# AGENTS.md

给 Codex 和其他研发 Agent 的项目执行指引。**注释、测试、诊断和文档一律使用中文**，保留必要的英文术语、API 名和类型名。

## 1. 本文件的作用

本文件是 TgBuddy 的研发入口，负责说明：

- 当前做到哪里；
- 下一步做什么；
- 哪些设计已经确定，不能在实施中重新讨论；
- 每个阶段的交付、测试、删除项和完成门槛；
- 本仓库真实踩过的构建、UI 和运行时陷阱。

不要把本文件当成完整设计规格。需要细节时按以下优先级读取事实来源：

1. **已定设计决策**：[docs/06-设计决策.md](docs/06-设计决策.md)
2. **目标代码仓库设计**：[docs/07-代码仓库设计.md](docs/07-代码仓库设计.md)
3. **架构设计**：[docs/01-架构设计.md](docs/01-架构设计.md)
4. **第一版功能范围**：[docs/02-功能范围.md](docs/02-功能范围.md)
5. **UI 唯一事实来源**：`tgbuddy-mockup/TgBuddy 交互原型.dc.html`
6. **当前纵向切片计划**：`.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`
7. **开发恢复记录**：`.ship/tasks/target-code-repository-architecture/dev-ledger.md`
8. **历史大 Story 计划（仅供追溯，不再作为开发单位）**：`.ship/tasks/target-code-repository-architecture/plan/plan.md`

如文档与当前代码不一致，先用测试和代码确认事实，再更新文档；不要静默选择其中一个版本。

---

## 2. 项目定位

TgBuddy 是按用户自有功能设计打造的、基于 **pi 内核**的通用本地桌面智能体，技术栈为 Electron、React、TypeScript、Bun、`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`。

它不是任何外部产品的复刻。核心产品能力是 Agent Runtime、Tool、MCP、Skill、Workspace、权限、结果产物、可恢复会话和单层子 Agent；交互原型是当前 UI/行为事实来源，不是外部产品规格。

产品只做 Agent 模式，不做普通 Chat 模式。第一版目标是完成一个可恢复、可授权、可扩展的本地 Agent 闭环：

```text
用户消息和附件
  -> 恢复 Session 与 Workspace
  -> AgentHarness 构造上下文和能力
  -> Provider / Tool / MCP / Skill
  -> 权限与 per-run Sandbox
  -> 消息、Blob 和 Artifact 持久化
  -> UI 流式展示与重启恢复
```

第一版明确不做：

- 独立 npm SDK；
- 第三方插件 ABI 和插件市场；
- 完整 Team 产品、任务 DAG、parallel/chain/router；
- 云端多租户、远程协作和分布式调度；
- 向量数据库替代 Session canonical storage；
- 无真实消费者的抽象层、复杂 DI 容器和反射式模块系统。

**不再限制 `src/` 文件数量。** 只在功能迁入时创建有真实职责的文件，不预建空目录或空接口。

---

## 3. 当前进度快照

更新时间：**2026-07-31**

### 3.1 已完成

#### Phase 0 · Packaged Electron SQLite Spike

状态：**完成**

已验证：

- packaged Electron 中使用目标 SQLite backend；
- 1000 entries、交替追加和连续前缀；
- WAL checkpoint 与备份；
- 强杀恢复；
- compaction、delete/cleanup；
- legacy JSONL 解析、坏行诊断和幂等导入；
- evidence 不泄漏运行时绝对路径。

关键提交：

- `62f4213 feat: complete packaged electron sqlite spike`
- `fc8a3d1 fix: execute sqlite spike scenarios in required order`

该 Spike 是 Story 1B 的回归门槛，不重复开发，也不能被生产代码直接复制为第二套实现。

#### Phase 1 · Story 1A：仓库边界与 Runtime 门面

状态：**完成，peer review PASS**

已经建立：

- `src/shared/contracts/**` 公共契约；
- `TgBuddyRuntime`、`RuntimeDependencies`、`RuntimeEvent` 和统一订阅入口；
- `src/main/bootstrap/create-application.ts` 唯一 Composition Root；
- `src/main/bootstrap/create-legacy-runtime.ts` 有删除期限的迁移适配层；
- `IpcCommandMap`、`IpcRequest`、`IpcResponse` 和 `TgBuddyAPI` 统一 IPC 类型源；
- Preload 的 `satisfies TgBuddyAPI` 编译期校验；
- TypeScript/Vite 一致的 alias；
- `scripts/check-architecture.ts` 自动依赖检查；
- 静态 import、dynamic import、目录 index、后缀、tsconfig paths、Vite alias 和真实 `src/main/ipc.ts` 的回归测试；
- [docs/07-代码仓库设计.md](docs/07-代码仓库设计.md) 和开发 ledger。

验证结果：

- `bun run check:architecture`：通过；
- `bun run typecheck`：通过；
- `bun test`：**52/52**，119 assertions；
- `bun run build`：通过；
- fresh peer review：10/10 验收项通过，无 finding。

关键提交：

- `392b505 feat(architecture): establish runtime boundary`
- `83a9782 fix(architecture): close boundary checker gaps`
- `8f694c9 docs(ship): record story 1a completion`

#### M1 · 可恢复 Agent 内核

状态：**完成；K01–K17、集中 review、Electron E2E 与探索式 QA 全部通过**

当前基座已经完成：

- App catalog 与 pi Session backend 共用同一 SQLite 物理文件、独立 schema；
- Session catalog、消息回放和 legacy JSONL 一次性导入进入生产 Composition Root；
- Runtime 持有 RunRegistry，支持同 Session 单飞与跨 Session 并行；
- `PiAgentEngine` 通过 pi `AgentHarness` 输出 thinking/text/error/message_end；
- `message_end` 只在 Harness 已提交对应 Session entry 后发布，信封 ID 与重启回放一致；
- Runtime 统一 settled 顺序；成功/失败状态直接推送侧栏，engine throw 和落盘失败不会静默；
- Runtime 通过每个 Run 独立的 `AbortSignal` 级联停止 AgentHarness；主动停止后 Session 持久化为 interrupted/“用户已停止”，迟到事件在 Runtime 与 Renderer 双重丢弃；
- 生产 PiAgentEngine 已装入内置 Tool 和显式 ToolPolicy 端口；工具等待、执行、成功/失败、停止后 unknown 与历史回放进入同一事件链；
- 启动恢复会把 SQLite 中遗留的 running Session 幂等标记为 interrupted，并向 pi Session 追加可回放系统标记；历史不丢且下一 Run 可继续；
- Runtime 统一负责手动压缩、85% 自动压缩、3 秒延迟、排队输入与取消恢复；
- 用户可从任意历史用户消息“编辑并重发”或“从此新建会话”；前者移动线性 active leaf，后者复制 active prefix 并保留 `originRef`；
- `src/main/session-store.ts`、裸 `orchestrator.ts`、旧 compaction owner 和 `src/kernel/*.ts` 旧适配已物理删除；
- Session/Run/Context 的 canonical owner 已收口到 Runtime、SQLite adapter 与 `kernel/pi`。

最近验证：

- M1 最终 gate：`bun test` **115/115**，333 assertions；architecture、typecheck、E2E typecheck、build 通过；
- `bun run spike:sqlite`：packaged Electron 39.8.10 / Node 22.22.1 / SQLite 3.51.2 的 12 个场景通过；
- `bun run probe`：真实文本流、ToolPolicy、工具事件、多轮恢复和 AbortSignal 通过；
- `bun run probe:compaction`：真实摘要调用通过；
- `bun run dev`：Vite 与 Electron 启动、legacy 幂等迁移和 Renderer 加载通过；
- 整个 M1 的集中 review 已 clean；Playwright Electron E2E **5/5** 通过，覆盖恢复、停止、工具、压缩、编辑重发和克隆；
- E2E 发现并修复 Runtime 裸转交 `RunCoordinator.stop/isRunning` 导致实例接收者丢失的问题；
- Electron 探索式 QA 覆盖空状态、新建会话、权限模式、运行/停止、正常回复、工具详情、编辑重发、分叉、键盘输入、重载恢复和上下文面板；
- QA 发现的唯一 P2（中止会话误显示“未开始”）已修复；定向单测 **19/19**、定向 E2E **1/1**、等待 8.5 秒的 Electron 回归均通过，未解决 finding 为 0；
- QA 报告与截图：`.ship/tasks/tgbuddy-vertical-slices/qa/electron-report.md`。

M1 交付的是一个可恢复、可停止、可持久化、可执行工具和可压缩上下文的完整 Agent Harness 基座。它不是产品能力的终点：Workspace/ExecutionEnv、MCP、Skill、通用 Tool 注册、附件/Artifact 和单层 child 仍按 M2–M5 逐 Slice 接入真实 Run。

### 3.2 当前下一步

**M1 已关闭；下一 Slice 是 S01“Workspace catalog 与选择器”。不重做 M1、Phase 0 或 Story 1A。**

```text
M1 review ✅ -> E2E ✅ -> QA ✅
  -> S01 Workspace catalog 与选择器
    -> S02–S11 Workspace 与安全
    -> C01–C12 Tool / Skill / MCP 通用能力
      -> A01–A09 Blob / 附件 / Artifact
        -> D01–D04 单层 child
          -> U01–U09 产品与原型收口
```

旧 Story 1B–6 只保留为历史迁移分组，不再作为实施单位。每次 `$ship:dev` 默认只领取 1 个 Slice；除非当前 Slice 的验收标准要求，不提前实施后续 Slice，也不绕过依赖顺序。

---

## 4. 目标架构与依赖红线

```text
shared <- runtime
shared + runtime ports <- kernel/pi
shared + runtime ports <- infrastructure
shared + runtime public API + factories <- main/bootstrap
shared + runtime public API <- main/ipc
shared <- preload
shared <- renderer
```

### 4.1 各层职责

| 层 | 唯一职责 |
|---|---|
| `src/shared/contracts` | 跨进程、跨边界的可序列化 DTO、ID、事件和 IPC contract |
| `src/runtime` | 业务语义、用例、状态机和端口 |
| `src/kernel/pi` | pi Agent、Session backend、模型、压缩、Skill 和 Tool hook 适配 |
| `src/infrastructure` | SQLite、Blob、文件系统、Secret 和 MCP transport |
| `src/main/bootstrap` | 显式实例化并连接所有 adapter |
| `src/main/ipc` | 输入校验、调用 Runtime、错误映射和事件转发 |
| `src/preload` | 将 typed IPC 暴露为 `window.tgbuddy` |
| `src/renderer` | 前端 feature state、交互和展示 |

### 4.2 强制规则

- Runtime 不得 import Electron、React、Node 文件系统、SQLite、pi 或具体 infrastructure。
- pi 的**运行时调用**只允许出现在 `src/kernel/pi/**`。
- pi message type 只允许按既定例外出现在 `src/shared/contracts/message.ts` 和 `events.ts`。
- Main IPC 不得直接 import repository、store、kernel 或 Runtime 内部 service。
- Renderer 不得 import Main、Runtime、kernel、infrastructure、Electron、Node runtime。
- Preload 只依赖 shared contract 和 Electron context bridge。
- 不使用通用 DI 容器；`createApplication()` 使用显式构造。
- 所有反向依赖必须被 `bun run check:architecture` 阻止。
- 不得为“暂时方便”扩展 legacy 豁免；如确需新增，必须同时写明删除 Story 和回归测试。

### 4.3 Compatibility 层删除期限

| 旧 owner | 删除 Story |
|---|---|
| `src/main/session-store.ts` | ✅ K17 已删除 |
| `src/main/orchestrator.ts` | ✅ K17 已删除 |
| `src/main/compaction-service.ts` | ✅ K14 已删除 |
| `src/kernel/*.ts` 旧适配 | ✅ K17 已删除，生产适配只在 `src/kernel/pi/**` |
| `src/main/permission-service.ts` | S11 |
| `src/main/plan-service.ts` | S09 |
| `src/main/ask-user-service.ts` | S10 |
| `src/main/tools/sandbox.ts` | S11 |
| `src/main/tools/sandboxed-env.ts` | S11 |
| `src/main/channel-store.ts` | C12 |
| `src/main/tools/index.ts` | C12 |
| `src/main/tools/plan-mode.ts` | S09 |
| `src/main/tools/ask-user.ts` | S10 |
| `src/main/ipc.ts` 单文件 owner | U08，拆为领域 handler |
| `src/shared/types/**` re-export | U08 |
| `src/renderer/atoms/agent.ts` 总 atom | U08，拆为 feature state |
| `src/renderer/hooks/useGlobalAgentListeners.ts` 总监听器 | U08，拆为 event router |

Compatibility 层只能委托旧实现，不能新增产品入口、复制业务规则或成为第二个长期门面。

---

## 5. 完整开发计划

完整的文件、RED、GREEN、验证和删除项见：

- `.ship/tasks/tgbuddy-vertical-slices/plan/spec.md`
- `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`
- `.ship/tasks/tgbuddy-vertical-slices/plan/diff-report.md`

本节是 Agent 开工索引。任何 Slice 不得因为本表简写而省略详细计划中的验收。

### 5.1 里程碑

| 顺序 | 里程碑 | Slice | 状态 | 可演示结果 |
|---:|---|---|---|---|
| 0 | SQLite packaged spike | B00 | ✅ 完成 | 打包、恢复、备份、legacy import |
| 1 | 仓库边界与 Runtime 门面 | B01 | ✅ 完成 | contracts、Runtime、Composition Root、checker |
| 2 | M1 可恢复 Agent 内核 | K01–K17 | ✅ 开发、review、E2E、QA 完成 | 会话、消息、流式、停止、工具、恢复、压缩 |
| 3 | M2 Workspace 与安全 | S01–S11 | 待开始 | mount、ExecutionEnv、权限、Plan、ask_user |
| 4 | M3 通用能力系统 | C01–C12 | 待开始 | Channel、Profile、Tool、Skill、MCP |
| 5 | M4 附件与结果 | A01–A09 | 待开始 | Blob、附件、长输出、Artifact、结果区 |
| 6 | M5 单层 child | D01–D04 | 待开始 | lineage、预算、取消、权限、过程组 |
| 7 | M6 产品收口 | U01–U09 | 待开始 | 7 个原型场景、7 条 E2E |

### 5.2 M1：可恢复 Agent 内核

| Slice | 一个主要行为 | 用户可见/验证锚点 |
|---|---|---|
| K01 | AppDatabase `app_*` 迁移协议与 packaged 证明 | 同一 `tgbuddy.db`；不碰 pi 私表 |
| K02 | SQLite SessionCatalogRepository | `002_app_sessions.sql` + CRUD/reopen |
| K03 | AppDatabase/SessionRepo 装配和侧栏切换 | compatibility 注入、dispose、重启仍可见 |
| K04 | pi Session backend 适配器 | 同 DB 路径、独立连接/迁移、append/reopen/isolation |
| K05 | 消息历史切换 pi backend | `main`；完整消息重启回放 |
| K06 | legacy JSONL 一次性幂等导入 | `sessions`；坏行有诊断 |
| K07 | RunRegistry 单 Session 单飞 | 同 Session 拒绝、跨 Session 并行 |
| K08 | PiAgentEngine 文本流 | `main`；thinking/text/message_end |
| K09 | settled、消息落盘和失败状态 | `main` + `sessions` |
| K10 | Stop、Abort 与迟到事件丢弃 | `main` 停止按钮 |
| K11 | 工具调用四态闭环 | `tools`；保留 120ms 重排 |
| K12 | 重启恢复 interrupted Run | `sessions` + 系统标记 |
| K13 | 手动压缩闭环 | `context`；原消息可展开 |
| K14 | 85% 自动压缩与 3 秒稍后 | `context`；输入可排队 |
| K15 | 编辑并重发的线性截断 | `sessions`；不创建分支 |
| K16 | 从此新建扁平 Session | `sessions`；复制 active prefix |
| K17 | 删除 Session/Run legacy owner | M1 全 gate |

### 5.3 M2：Workspace 与安全

| Slice | 一个主要行为 | 用户可见/验证锚点 |
|---|---|---|
| S01 | Workspace catalog 与选择器 | `main` picker、`empty` |
| S02 | mount 缺失与恢复 | host error + 恢复动作 |
| S03 | per-run ExecutionEnv 隔离 | A/B Workspace 不串路径 |
| S04 | canonical path 与逃逸拒绝 | `tools` 失败态 |
| S05 | PolicyEngine allow/ask/deny | `perm`、`settings/tools` |
| S06 | inline 权限队列与重载恢复 | `perm` inline card |
| S07 | 工具×范围×有效期规则持久化 | `perm`、`settings/rules` |
| S08 | 高危模态与 neverPersist | `perm` modal |
| S09 | Plan 模式 | `main` mode chip + plan card |
| S10 | ask_user 结构化提问 | `main` question card |
| S11 | 删除安全 legacy owner | M2 全 gate |

### 5.4 M3：Tool、Skill、MCP 通用能力

| Slice | 一个主要行为 | 用户可见/验证锚点 |
|---|---|---|
| C01 | SecretStore | 明文不进 SQLite/Renderer |
| C02 | Channel CRUD | `settings/model` |
| C03 | Channel 测试与模型发现 | 连接诊断、模型列表 |
| C04 | Profile 与模型选择 | 输入区 chip；下一 Run 生效 |
| C05 | ToolRegistry 与 builtin snapshot | `settings/tools` 数据源 |
| C06 | 工具三档权限设置 | allow/ask/deny |
| C07 | Skill manifest 发现 | `settings/skills` 按来源分组 |
| C08 | Skill 正文按调用加载 | 不把全部正文塞 prompt |
| C09 | MCP 配置、连接与状态 | `settings/mcp` service card |
| C10 | MCP tool 发现 | 进入下一 Run capability snapshot |
| C11 | MCP tool 权限与调用 | `tools`、`perm`、host error |
| C12 | CapabilitySnapshot 与 token 账本 | `context`；删除旧 channel/tools owner |

### 5.5 M4：Blob、附件与结果

| Slice | 一个主要行为 | 用户可见/验证锚点 |
|---|---|---|
| A01 | 内容寻址 BlobStore | dedupe/hash/atomic test |
| A02 | 附件选择、预览与持久化 | `main` attachment chip |
| A03 | 附件进入模型上下文 | 图片/文本可回放 |
| A04 | >256KB 工具输出 Blob 化 | `tools` 8 行预览 + 完整输出 |
| A05 | Artifact 投影 | 从 Tool args + 成功结果推导 |
| A06 | 结果列表、分组与筛选 | `main` 结果区 |
| A07 | 只读预览与外部打开 | 结果预览 |
| A08 | “让 Agent 改这份”入口 | 只注入输入，不自动发送 |
| A09 | Blob 引用计数与恢复清理 | M4 全 gate |

### 5.6 M5：单层子 Agent

| Slice | 一个主要行为 | 用户可见/验证锚点 |
|---|---|---|
| D01 | Run lineage 与共享预算 | depth=1、统一预算 |
| D02 | 同步 child run 与结果回传 | child result 回父 toolResult |
| D03 | child 取消与权限继承 | 父 stop 级联、权限标来源 |
| D04 | 子 Agent 折叠组 UI | `tools` 过程组 |

### 5.7 M6：产品与原型收口

| Slice | 一个主要行为 | 用户可见/验证锚点 |
|---|---|---|
| U01 | 整窗空状态 | `empty` |
| U02 | 会话分组与搜索 | `sessions` list |
| U03 | 会话菜单动作 | rename/pin/archive/delete/线性动作 |
| U04 | 设置 Shell | model/rules/tools/MCP/skills |
| U05 | 主窗口与结果区视觉收口 | `empty`、`main` |
| U06 | 工具与权限视觉收口 | `tools`、`perm` |
| U07 | 上下文、会话与设置视觉收口 | `context`、`sessions`、`settings` |
| U08 | IPC、Renderer feature 与 compatibility 收口 | 仅重构，七场景回归 |
| U09 | 7 条 E2E 与第一版验收 | 真实 Electron evidence |

### 5.8 Slice 尺寸护栏

- 每个 Slice 只允许一个主要行为，目标 0.5–1.5 个开发日。
- 默认不超过 6 个生产文件；超过时先拆，或在 ledger 解释不能再拆的原因。
- 连续两个纯基础设施 Slice 后必须有一个真实 Runtime/IPC/Renderer 消费者。
- 同时含两个用户流程、两个持久化聚合或“新 IPC + 新整页 UI”时必须继续拆分。
- 每个 Slice 独立 RED、GREEN、targeted 验证和 commit；M1 在 E2E 前集中 peer review。

---

## 6. 每个 Slice 的统一执行流程

每个 Slice 都必须按以下顺序执行：

1. 读取计划、相关设计文档、当前 ledger 和最接近的代码模式。
2. 核对依赖和当前工作树，保留任务外改动。
3. 将验收标准写成失败测试，先确认 Red。
4. 写满足当前 Slice 的最小实现，不提前做后续 Slice。
5. 删除本 Slice 负责的旧 owner；不能只增加新层而保留双 owner。
6. 运行 targeted test、architecture、typecheck；仅按 Slice 风险追加 build/probe/spike。
7. 使用 Conventional Commit，只暂存本 Slice 文件。
8. 更新 `.ship/tasks/<slice-id>/dev-ledger.md`，直接进入下一个 Slice。
9. K17 后、E2E 前对整个 M1 做一次集中独立 peer review。
10. 集中修复 finding 并通过 fresh review 后，依次进入 `$ship:e2e`、`$ship:qa`。

### Slice 完成定义

一个 Slice 只有同时满足以下条件才算完成：

- 验收标准全部有可复现证据；
- 新 owner 已接管真实生产调用；
- 本 Slice 负责的旧 owner 已删除或收缩到有明确下一删除期限的 adapter；
- `bun run check:architecture` 通过；
- `bun run typecheck` 通过；
- targeted test 通过；里程碑集中评审前 `bun test` 全部通过；
- 涉及 Main/Preload/Renderer/入口的 Slice 执行 `bun run build`；
- Slice 要求的 probe/spike/integration/E2E 通过；
- M1 集中 peer review 在 E2E 前为 PASS；
- ledger 已记录 commit、文件和产出接口。

不允许用以下方式制造完成：

- 放宽断言；
- hardcode fixture；
- 添加 skip/xfail；
- 只建目录和空接口；
- 静默保留第二套 owner；
- 用 compatibility 豁免绕过架构检查；
- 将失败吞掉或只写日志继续产生副作用。

---

## 7. 常用命令

```bash
bun run dev                # Vite + Electron，热重载
bun run probe              # 不启动 Electron，验证 pi 内核
bun run probe:compaction   # 验证压缩链路
bun run spike:sqlite       # packaged Electron SQLite 回归
bun run check:architecture # 检查依赖边界
bun run typecheck
bun test
bun run build
```

修改不同区域后的最低验证：

| 修改区域 | 至少运行 |
|---|---|
| `src/kernel/pi/**` | targeted test + `bun run probe` + 全套 gate |
| SQLite / Session | integration + `bun run spike:sqlite` + 全套 gate |
| Runtime | unit/integration + architecture + 全套 gate |
| Main / Preload / IPC | IPC contract + typecheck + build |
| Renderer | targeted test + typecheck + build；交互改动还要运行时 QA |
| CSS / Tailwind | build + 运行时截图核对；改 Tailwind 配置后重启 dev server |

当前 `bun run build` 会报告 Renderer 主 chunk 约 690KB 的 Vite 警告。这是已知基线，不得通过单纯调高 warning limit 隐藏；在 U08 结合 feature 拆分和动态加载解决。

---

## 8. UI 还原规则

**`tgbuddy-mockup/TgBuddy 交互原型.dc.html` 是 UI 的唯一事实来源。**

调样式不要凭截图目测。原型数值是内联样式，直接读取：

```bash
rg -n "isTool" "tgbuddy-mockup/TgBuddy 交互原型.dc.html"
rg -n "const ST = \\{" "tgbuddy-mockup/TgBuddy 交互原型.dc.html"
rg -n "const decisions = \\[" "tgbuddy-mockup/TgBuddy 交互原型.dc.html"
```

已验证的通用规则：

- 前端组件优先复用 AI Elements；先检查现有 `src/renderer/components/ai-elements/**` 和 AI Elements 可用组件，确实没有对应能力时才创建项目自有组件。
- Markdown、流式正文和对话滚动优先参考并复用现有 `Response`、`Conversation`、streamdown 和相关样式，不重建第二套渲染链路。
- 组件的结构、状态和交互来自原型；复用 AI Elements 时也必须按原型调整组合与样式，不能用组件默认效果替代产品设计。
- 颜色标记异常，不标记常态；成功态保持灰蓝，不让整屏发绿。
- 安静状态用文字，失败和等待授权才用明显颜色。
- 结构与状态分开；不能为了弱化成功色把 Tool 容器也去掉。
- 用四级灰阶背景区分区域，边框保持 `rgba(255,255,255,.05)` 级别。
- 工具卡收到 `tool_start` 后延迟 120ms 进入执行中；期间收到授权请求就取消。
- Tool 至少区分等待授权、执行中、成功、失败和已拒绝。
- 标准 shadcn 组件用生成器创建，不复制其它项目组件文件。

---

## 9. 已知陷阱

### 样式与构建

- 修改 `tailwind.config.js` 后必须重启 dev server，Vite 的 PostCSS 缓存不会自动失效。
- CSS `@import` 必须位于所有普通语句之前。
- `--border` 必须存最终实色，不能存白色再依赖透明度。
- shadcn CSS 变量是硬要求；缺少 `border-border` 等变量会在深色背景出现白边。
- `prose` 与 streamdown 会叠加代码块样式和反引号伪元素；只中和冲突规则，不能整体移除 prose。

### 布局

- flex 子项内部需要滚动时通常必须加 `min-h-0`。
- `StickToBottom.Content` 的 `scrollClassName` 给外层滚动容器，`className` 给内层内容容器。

### 运行时

- Bun 自动加载 `.env`，Electron 不会；开发主进程必须显式加载。
- Electron 二进制使用 npmmirror；空 `node_modules/electron/dist` 会让安装脚本误判成功。
- pi 的 `stream` 不保证 throw；失败通过 `error` event 传递，必须一路送到 UI。
- `tool_execution_start` 比权限请求早约 5ms，不能直接显示“正在执行”。
- 同一 Session 同时只允许一个 root Provider stream，不同 Session 可以并行。
- 存储 degraded 后必须阻止继续产生副作用，不能只打印错误。

### 数据与工具

- 消息保持 pi 原始格式，不做第二层归一化翻译；会话护栏为 `kernel: 'pi@0.82'`。
- pi Tool 的 `details` 形状不可依赖，内置 `write` 可能返回 `undefined`。
- 产物识别必须从 Tool 参数和成功结果推导。
- `bash` 无法靠静态路径分析成为硬沙箱；实际防线是权限询问、危险规则和受控 ExecutionEnv。
- 删除默认进入回收站；批量或破坏性删除必须再次询问。

---

## 10. 代码与 Git 规范

- 永远不用 `any`，创建准确的 interface 或 union。
- 对象类型优先 `interface`。
- 仅类型导入使用 `import type`。
- 注释解释“为什么”，不解释显而易见的“做了什么”。
- 不复制业务逻辑来规避依赖方向；抽取端口或移动 owner。
- 不使用通用 service locator 或 DI 容器。
- 使用 Conventional Commits。
- 只暂存当前 Slice 文件，不使用 `git add .` 或 `git add -A`。
- 不覆盖、不清理、不提交任务外工作树改动。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性恢复命令。

开始任何研发任务前，先查看：

```bash
git status --short --branch
git log -8 --oneline
Get-Content .ship/tasks/target-code-repository-architecture/dev-ledger.md
```

恢复开发时以 ledger 和 Git commit 为准，不凭对话记忆重新实施已完成 Story。
