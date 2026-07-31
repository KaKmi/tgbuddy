# AGENTS.md

给 Codex 和其他研发 Agent 的项目执行指引。**注释、测试、诊断和文档一律使用中文**，保留必要的英文术语、API 名和类型名。

## 1. 本文件的作用

本文件是 TgBuddy 的稳定研发指引，负责说明：

- 哪些设计已经确定，不能在实施中重新讨论；
- 代码结构、依赖方向和 Compatibility 删除边界；
- 每个 Slice 的执行流程、测试门槛和 Git 规范；
- UI 还原规则以及本仓库真实踩过的构建、布局和运行时陷阱。

**动态项目进度不在本文件维护。** 当前里程碑、下一 Slice、最近验证和完成证据统一见 [docs/08-项目进度.md](docs/08-项目进度.md)。

不要把本文件当成完整设计规格。需要细节时按以下优先级读取事实来源：

1. **已定设计决策**：[docs/06-设计决策.md](docs/06-设计决策.md)
2. **项目进度与下一 Slice**：[docs/08-项目进度.md](docs/08-项目进度.md)
3. **目标代码仓库设计**：[docs/07-代码仓库设计.md](docs/07-代码仓库设计.md)
4. **架构设计**：[docs/01-架构设计.md](docs/01-架构设计.md)
5. **第一版功能范围**：[docs/02-功能范围.md](docs/02-功能范围.md)
6. **UI 唯一事实来源**：`tgbuddy-mockup/TgBuddy 交互原型.dc.html`
7. **当前纵向切片计划**：`.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`
8. **开发恢复记录**：`.ship/tasks/target-code-repository-architecture/dev-ledger.md`
9. **历史大 Story 计划（仅供追溯，不再作为开发单位）**：`.ship/tasks/target-code-repository-architecture/plan/plan.md`

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

## 3. 研发资料职责

从 2026-07-31 起，稳定规则与动态进度分开维护，避免每完成一个 Slice 都改写本文件。

| 内容 | 唯一维护位置 |
|---|---|
| 当前里程碑、下一 Slice、最近验证、完成提交 | `docs/08-项目进度.md` |
| 每个 Slice 的文件、RED、GREEN、验收和删除项 | `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md` |
| 研发恢复过程和逐 Slice 产出接口 | 对应 `.ship/tasks/**/dev-ledger.md` |
| 已定产品与架构决策 | `docs/06-设计决策.md` 与专项设计文档 |
| UI、状态和交互事实 | `tgbuddy-mockup/TgBuddy 交互原型.dc.html` |
| 代码结构、执行红线、验证规则和踩坑经验 | `AGENTS.md` |

开始研发任务时先读取项目进度，再读取当前 Slice 计划和 ledger。不要根据 `AGENTS.md` 中的历史描述判断当前做到哪里，也不要把逐次测试数字和 commit 流水重新写回本文件。

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
| `src/main/permission-service.ts` | ✅ S11 已删除 |
| `src/main/plan-service.ts` | ✅ S09 已删除 |
| `src/main/ask-user-service.ts` | ✅ S10 已删除 |
| `src/main/tools/sandbox.ts` | ✅ S11 已删除 |
| `src/main/tools/sandboxed-env.ts` | ✅ S11 已删除 |
| `src/main/channel-store.ts` | ✅ C12 已删除（拆为 data-dir + legacy-channels） |
| `src/main/tools/index.ts` | ✅ C12 已删除（内置工具迁入 kernel/pi，回收站经注入端口） |
| `src/main/tools/plan-mode.ts` | ✅ S09 已删除 |
| `src/main/tools/ask-user.ts` | ✅ S10 已删除 |
| `src/main/ipc.ts` 单文件 owner | U08，拆为领域 handler |
| `src/shared/types/**` re-export | U08 |
| `src/renderer/atoms/agent.ts` 总 atom | U08，拆为 feature state |
| `src/renderer/hooks/useGlobalAgentListeners.ts` 总监听器 | U08，拆为 event router |

Compatibility 层只能委托旧实现，不能新增产品入口、复制业务规则或成为第二个长期门面。

---

## 5. Slice 计划与尺寸护栏

完整的文件、RED、GREEN、验收和删除项见：

- `.ship/tasks/tgbuddy-vertical-slices/plan/spec.md`
- `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`
- `.ship/tasks/tgbuddy-vertical-slices/plan/diff-report.md`

当前里程碑与下一 Slice 见 `docs/08-项目进度.md`。本文件只保留不会随每次提交变化的执行规则，不复制里程碑状态和逐 Slice 进度表。

### 5.1 Slice 尺寸护栏

- 每个 Slice 只允许一个主要行为，目标 0.5–1.5 个开发日。
- 默认不超过 6 个生产文件；超过时先拆，或在 ledger 解释不能再拆的原因。
- 连续两个纯基础设施 Slice 后必须有一个真实 Runtime/IPC/Renderer 消费者。
- 同时含两个用户流程、两个持久化聚合或“新 IPC + 新整页 UI”时必须继续拆分。
- 每个 Slice 独立 RED、GREEN、targeted 验证和 commit；里程碑结束后再做集中 review、E2E 和 QA。

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
9. 里程碑最后一个 Slice 完成后、E2E 前做一次集中独立 peer review。
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
- 里程碑集中 peer review 在 E2E 前为 PASS；
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
Get-Content docs/08-项目进度.md
Get-Content .ship/tasks/target-code-repository-architecture/dev-ledger.md
```

恢复开发时以 ledger 和 Git commit 为准，不凭对话记忆重新实施已完成 Story。
