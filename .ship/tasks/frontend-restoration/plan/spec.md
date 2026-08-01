# TgBuddy 前端完整还原规格

## 1. 目标

把当前“功能已接通但仍像临时壳”的 Renderer，收口为可长期使用的 TgBuddy 桌面界面：以 `designs/tgbuddy-codex-light-v2/TgBuddy Codex Light v2.html` 的纸白/暖炭灰视觉、布局密度和响应式形态为直接视觉对照，以 `tgbuddy-mockup/TgBuddy 交互原型.dc.html`、现有 Runtime/IPC 和既有 E2E 为行为事实来源，完整覆盖主窗口、会话、输入、工具、授权、上下文、结果区、设置与空状态交互。

本任务主体是 Renderer 表达和 Renderer 内部状态组织，不重写 Agent Runtime、Main IPC、Preload 或既有存储语义。只有 LLM Session Title 与工作区只读文件树缺少真实消费者 contract，允许各自以独立“契约/架构”Slice 增加最小纵向闭环；其余 UI 必须继续使用现有 `window.tgbuddy`。不得把设计稿中的交易风控、报告文件、连接器或会话 fixture 写进生产代码。

## 2. 事实来源与冲突裁决

1. **行为和安全语义**：`tgbuddy-mockup/TgBuddy 交互原型.dc.html:1269-1280`、`docs/02-功能范围.md:49-66` 和当前已通过的 E2E 优先。工具授权优先级、85% 压缩、线性会话、只读产物预览等规则不能因换皮改变。
2. **本轮视觉方向**：以 `designs/tgbuddy-codex-light-v3/TgBuddy Codex Light v3.html` 为最终视觉与交互基线；v2 仅用于追溯。V3 保留纸白/暖炭灰和三栏结构，但把 Composer、设置和结果区收敛为轻量按需展开。
3. **真实产品能力**：当前 Runtime/IPC 与代码优先于设计稿假交互。当前已经有工作区选择、附件、编辑重发、派生会话、模式、Profile/模型、权限规则、Skill、MCP、产物预览和停止运行等真实入口（`src/renderer/App.tsx:171-307`、`src/shared/contracts/ipc.ts:298-359`）。
4. **冲突项**：Codex Light v2 的工具设置使用可编辑 per-tool 三档（`designs/tgbuddy-codex-light-v2/components.jsx:235-248`），但当前产品已收口为“模式 + 持久授权规则 + 分类默认”，并且 E2E 明确要求内置工具不再提供可编辑三档（`tests/e2e/m3-settings.e2e.ts:79-97`）。实现只借用设置中心的视觉结构：工具页展示只读默认权限与说明，实际可删除的组合授权规则单独展示；不得恢复 per-tool 三档编辑。
5. `docs/06-设计决策.md:153-161` 仍残留旧三档描述，与当前代码和里程碑决策不一致。本任务实施时应同步修正文档，但不得据此逆转现有权限实现。

## 3. 当前调查结论

### 3.1 当前壳仍是临时实现

- `src/renderer/App.tsx:1-7` 仍声明界面会整体替换，且一个文件同时拥有加载、业务动作、侧栏、时间线、输入区和多个弹层。
- HTML 在 `src/renderer/index.html:2-3` 写死 `class="dark"`，没有主题状态或持久化；这与 Codex Light v2 默认明亮、可切暖炭灰并记忆选择的实现（`designs/tgbuddy-codex-light-v2/app.jsx:1-22`）直接不一致。
- 当前主窗直接从三栏开始（`src/renderer/App.tsx:309-353`），对话区没有 48px 标题栏、运行状态 pill 或结果区显隐按钮；目标在 `designs/tgbuddy-codex-light-v2/app.jsx:41-50` 已定义三者。
- 当前输入区只放模式、模型和可选上下文入口（`src/renderer/App.tsx:599-683`）。V3 只补专家/Profile 与附件入口，继续保留模型和上下文；明确不加入 Skill/MCP 工作区 chip。
- 当前结果区固定 `w-72`、仅 `lg` 展示、列表在上且预览在底（`src/renderer/features/results/ResultsPanel.tsx:80-191`）；目标是可开关的 356px 面板、预览在上、分组列表在下，并在 1180px 以下成为覆盖层（`designs/tgbuddy-codex-light-v2/styles.css:359-392,457-459`）。
- 当前设置是 420px 右侧抽屉（`src/renderer/features/settings/ChannelSettingsPanel.tsx:379-387`），目标是 900×650 居中设置中心（`designs/tgbuddy-codex-light-v2/styles.css:394-407`）。
- 当前工具卡只让失败态默认展开，running/success 不显示文字状态（`src/renderer/components/ToolCard.tsx:42-57,100-105`）；原型要求等待授权/执行中/失败默认展开、成功折叠，状态变化后自动收口（`tgbuddy-mockup/TgBuddy 交互原型.dc.html:1276,1525`）。

### 3.2 必须保留的真实行为

- 会话加载、新建、选择、工作区切换和真实 mount 恢复提示已接通（`src/renderer/App.tsx:116-205,352-427`）。
- 会话搜索、分组、菜单、编辑重发与从此新建会话已有生产实现（`src/renderer/App.tsx:279-307,437-499,919-939,1041-1147`），重做组件不能把它们退化为静态按钮。
- 时间线已经使用 AI Elements 的 `Conversation` / `Response`，并处理流式正文、工具、系统标记、授权、计划、提问、压缩与错误（`src/renderer/App.tsx:517-597`）；新界面必须复用这条链路，不能复制第二套 Markdown/滚动实现。
- 输入区的附件 stage/discard/send、压缩期间排队、停止和发送保护已接通（`src/renderer/App.tsx:216-262,620-688`）。
- 结果区已有真实 Artifact 列表、分组、筛选、预览、默认应用打开和“让 Agent 改这份”（`src/renderer/features/results/ResultsPanel.tsx:44-76,78-190`）。
- 设置页已有 Channel/Profile CRUD、密钥不回传、Skill 开关、MCP CRUD/连接/工具发现；这些行为由 `tests/e2e/m3-settings.e2e.ts:30-153` 保护，重排设置结构时必须全部保留。
- 高危权限模态、普通 inline 授权、计划审批、ask_user 和 120ms 工具活动防闪烁已有测试和语义，视觉改造不能改事件契约。

## 4. 设计方案

### 4.1 Renderer 结构

把 `App.tsx` 收缩为数据装配和顶层动作 owner，展示拆进现有 `features/`：

```text
App.tsx
  -> features/theme/use-theme.ts
  -> features/shell/AppShell.tsx
       -> features/session/SessionSidebar.tsx
       -> features/conversation/ConversationPane.tsx
            -> features/composer/AgentComposer.tsx
       -> features/results/ResultsPanel.tsx
  -> features/settings/SettingsDialog.tsx
       -> ModelProfileSettings.tsx
       -> PermissionToolSettings.tsx
       -> SkillMcpSettings.tsx
       -> AppearanceSettings.tsx
```

拆分只移动 Renderer owner，不改变 shared DTO 或 IPC。每个 Slice 完成时都保持 App 可运行，不允许先建空组件再等待后续接线。

### 4.2 主题与视觉 token

- 新用户默认 `light`，只提供 `light | dark` 两态；点击品牌栏和“外观”页都修改同一个状态。
- 状态存 `localStorage['tgbuddy-theme']`，启动时读取并写到 `document.documentElement.dataset.theme`；不得再依赖写死的 `.dark` class。
- 亮色和暗色 token 逐项采用 Codex Light v2 `styles.css:1-66`；现有 shadcn/Tailwind semantic token 继续保留，并映射到新 token，保证 AI Elements、streamdown 和现有组件不失效。
- 主题切换必须在页面级改变背景、文字、边框、状态软底和阴影，禁止只反转主背景。

### 4.3 主窗口与响应式

- Electron 内部窗口占满 viewport，不复制设计展示页外层的 `prototype-note`、18px 画布边距或圆角演示框；只复用 `app-window` 内部视觉。
- 桌面布局：侧栏 252px；对话区 `min-width: 430px`；结果区 356px；对话标题和结果标题均 48px；输入容器最大 820px、消息流最大 720px。
- `<1180px`：结果区改为右侧覆盖层并带遮罩/阴影，不挤压对话区；关闭后焦点回到“结果区”按钮。
- `<820px`：侧栏缩到 218px，输入区把模式/Profile 收进单个能力菜单但保持可访问；`<640px`：侧栏隐藏，结果区最大 `92vw`，设置左导航缩窄。页面内部不得出现横向滚动。

### 4.4 侧栏与会话

- 品牌行展示 TgBuddy 标识、主题按钮和设置按钮；工作区 selector 保留真实 path、选中态、挂载异常与“选择其他文件夹”。
- “新建会话”保留真实创建动作，并增加 `Ctrl+N` / `Meta+N` 快捷键；有输入焦点时也允许新建，但不得触发表单提交。
- 当前存在未发送正文或附件时，新建、切换工作区或切换会话必须先给出产品内确认，不能静默丢草稿；无草稿时保持一步完成。
- 搜索只承诺过滤当前工作区会话标题/状态摘要，因为当前没有跨会话 Artifact 搜索契约；占位文案使用“搜索会话”，不得显示无法兑现的“搜索会话与产物”。
- 分组、pin/status/time、SessionMenu 的重命名/置顶/归档/删除全部保留；搜索无结果与工作区无会话分别显示不同空状态。
- SessionMenu 改为统一 popover；重命名和删除使用产品内 Dialog，不再依赖 `window.prompt/confirm`。没有现成 IPC 的导出、通用 Tool replay 等动作不显示假按钮。
- 底部展示本地服务状态与版本；若暂无真实 health IPC，状态文案只能使用“本地模式”，不能伪造“服务正常”。

### 4.5 对话标题、时间线与工具

- 标题栏展示当前会话标题；运行中显示状态 pill；右侧“结果区”按钮控制面板显隐。无当前会话时显示“新任务”。
- 新会话发送首条消息后立即显示“正在生成标题…”；使用该 Run 已选择的 Provider/模型异步生成短标题。生成失败保留首条用户消息的安全截断标题；只有标题仍为默认/自动状态时可写回。用户手动重命名后设置锁定标记，迟到的生成结果不得覆盖。
- 用户消息、助手消息、Markdown、代码块和滚动继续使用现有 `Conversation` / `Response`，仅按目标密度、气泡、头像和留白重排。
- ToolCard 保持等待授权、执行中、成功、失败、已拒绝、未完成六态；等待授权/执行中/失败默认展开，成功/拒绝/未完成默认折叠；从 running 变 success 后自动收起，用户手动切换后不被无关重渲染重置。
- 工具卡继续只展示 8 行短预览、完整输出按需读取；child 结果保留“子智能体”标识。
- 授权、计划、ask_user、压缩和错误视觉统一到新 token；高危模态仍然阻断，普通权限仍 inline；1 个以上授权继续出现可跳转 toast。

### 4.6 输入区能力入口

- 同一 `AgentComposer` 只展示模式、专家/Profile、模型、上下文和附件。Skill/MCP 不再作为工作区级 chip，也不占输入区主路径；它们由 Runtime 按 Run 快照加载，在应用级“能力”设置中统一管理。
- 菜单只允许一个打开；打开任一菜单时关闭上下文面板；点击外部或 `Escape` 关闭；关闭后焦点返回触发按钮。
- 输入、附件、发送、停止和压缩排队保持当前真实行为。移除结果区“让 Agent 改这份”；若用户要修改，直接在 Composer 描述目标并通过附件或文件引用带入。`Enter` 发送、`Shift+Enter` 换行；IME composition 时 Enter 不得误发。
- 模式说明常驻输入框底部；完全访问使用异常色但不过度染色；发送按钮无内容时禁用，运行时只显示停止按钮。

### 4.7 结果区

- 面板可由标题栏和自身关闭按钮显隐，桌面默认打开；选择保持在当前会话内，切会话清空。
- 同一会话内关闭再打开时保留筛选与选中项；只有切换会话才清空。Artifact 条目可展示 contract 中真实存在的 `size` 与 `sourceSkill`，但不得根据文件名猜测 child/root 来源。
- 顶部使用“产物 / 工作区”双入口：产物保留类型筛选、预览卡和“本次任务/更早”时间列表；工作区展示可折叠文件树、文件筛选、自动刷新状态和 mount 异常。
- Markdown、代码、图片、CSV 提供轻量内联预览；PDF/Office/大文件显示文件信息与可用的预览降级动作；读取失败有重试。操作只保留“查看”和“系统打开”，不显示“让 Agent 改这份”。
- “查看”打开独立只读文件查看器，展示 breadcrumb、名称、类型/大小、真实内容、自动刷新状态与系统打开；关闭后焦点返回来源条目。
- 空状态解释“左边是过程，右边是结果”，并根据是否有当前会话使用不同文案。

### 4.8 设置中心

- 把抽屉改为 900×650 居中 Dialog，点击遮罩或 `Escape` 关闭；脏表单存在时不得静默丢弃，先使用本地确认提示。
- Dialog 必须把焦点限制在内部，关闭后返回打开设置的按钮；tab 切换不卸载并清空当前未保存表单。
- tabs 只承载真实能力：通用、模型、工具与权限、应用能力、外观；不得出现“后续接入”空页面。
- 通用页展示启动恢复、新会话默认模式、本地数据目录和脱敏诊断导出。Session 标题自动生成是固定行为，不提供设置项。
- 模型/Profile tab 保留所有 CRUD、连通性测试、密钥保密与错误反馈。
- 权限/工具 tab 读取 `permission.rules()` 和 `tool.list()`：显示可删除的组合授权规则与只读分类默认；不提供 per-tool 三档编辑。
- 应用能力页合并 Skill 与 MCP 的状态和管理入口，明确“所有工作区共用”；底层 Skill/MCP CRUD、连接、开关与错误恢复仍必须可达，但不再表达工作区级启用。
- 外观 tab 共用全局主题状态；进入设置时可指定初始 tab。

## 5. 验收标准

1. fresh userData 启动为纸白主题；切到深色后重载仍为暖炭灰，两个主题所有主区域、弹层和状态卡均可读。
2. 1500×900 下侧栏/标题/对话/结果/输入/设置的关键尺寸分别符合 252/48/720/356/820/900×650；不包含设计展示页外框。
3. 工作区切换、添加、mount 异常；会话新建、选择、搜索、分组、菜单、`Ctrl+N`；空状态样例均能操作真实数据。
4. 标题栏能显示当前会话和运行状态，并能打开/关闭结果区；1180、820、640 三档无横向滚动且结果区覆盖行为正确。
5. 模式、Profile、模型、上下文四个入口均可键盘聚焦并打开真实内容；菜单互斥、外部点击和 Escape 行为一致；Composer 不出现 Skill/MCP 工作区级 chip。
6. 输入区附件、Enter/Shift+Enter、IME、发送、停止和压缩排队不回归；结果区不存在“让 Agent 改这份”。
7. ToolCard 六态可辨；等待授权/执行中/失败默认展开，成功默认折叠，running→success 自动收起；120ms 授权优先逻辑继续通过。
8. inline 权限、高危模态、计划审批、ask_user、上下文压缩、系统标记、child 汇总与错误在亮/暗两主题下都可操作。
9. 结果区真实产物列表、筛选、分组、选择、四类内联预览、独立查看器、工作区文件树、刷新、系统打开和错误降级全部通过；面板宽 356px。
10. 设置中心各 tab 使用真实 IPC；现有 Channel/Profile/Skill/MCP E2E 全部通过；Skill/MCP 为应用级管理，权限页不出现可编辑 per-tool 三档。
11. 现有 `tests/e2e/m1-runtime.e2e.ts` 至 `m4-results.e2e.ts` 的产品闭环继续通过；`m4-results` 中“让 Agent 改这份”断言按新决策改为工作区文件树/查看器，不保留旧按钮兼容层，其余只更新稳定 locator，不放宽断言。
12. `bun test`、`bun run check:architecture`、`bun run typecheck`、`bun run build` 全过；新增前端 Electron E2E 覆盖主题持久化、壳交互、输入菜单、结果响应式和设置 tabs。
13. 运行时 QA 保存至少 light/dark 主窗、工具/授权、结果区、设置、空状态和 1180px overlay 的截图，并与目标 HTML 源码数值逐项核对。
14. 有未发送正文/附件时，新建或切换会话/工作区会确认；SessionMenu、重命名、删除、设置 Dialog 和能力 popover 均支持 Escape、外部点击（适用时）与焦点返回。
15. 首条用户消息触发一次异步 LLM 标题生成；成功实时更新 Header/Sidebar，失败保留安全截断 fallback，重启可恢复；手动重命名和迟到结果竞争时始终以用户标题为准。

## 6. 非目标与禁止捷径

- 不新增普通 Chat 模式、插件市场、Team DAG、会话树或新后端能力。
- 不复制 Codex 品牌资产，也不复制设计稿示例数据；“Codex Light”只描述中性、低装饰、纸白/暖炭灰视觉方向。
- 不恢复 per-tool 三档权限，不绕过 `PolicyEngine`，不让 Renderer 解释权限业务规则。
- 不重建 Markdown、Conversation 滚动、Tool 事件或 Artifact owner；复用现有 AI Elements、atom/事件与 IPC。
- 不以大范围 screenshot snapshot 代替行为断言；视觉测试使用关键 token/尺寸断言 + 运行时截图证据。
- 不在一个 Slice 中同时重写整个 `App.tsx`、设置和结果区；每个 Slice 一个主要行为、独立 RED/GREEN/commit，默认不超过 6 个生产文件。
- 不在没有真实 IPC 的情况下显示“导出会话”或“重放工具”等动作；缺少 contract 时记录后续缺口。

## 7. 风险与已确认假设

- `docs/06-设计决策.md` 的工具三档已落后于当前实现；按当前 E2E/里程碑裁决，并在实施时更新文档。
- Electron 当前未提供主题设置 IPC；本轮按用户给定设计稿采用 Renderer `localStorage`，只保证本机当前用户持久化，不声称跨设备同步。
- 当前没有全工作区产物搜索 IPC；本轮不伪造“搜索会话与产物”，只做真实会话搜索。
- `ChannelSettingsPanel.tsx` 超过千行，设置中心拆分是实现风险最高部分；必须先以现有 E2E 固定行为，再逐 tab 迁移，不能一次性重写后再补测试。
- `docs/08-项目进度.md` 声称 U08 已完成，但总 `App.tsx`、总 atom、总 listener、单文件 Main IPC 和 `shared/types` 仍在；本任务只随触达范围逐步拆 Renderer owner，不夹带 Main/IPC 大迁移，最终架构清理由独立 Slice/任务收口。
- Artifact contract 已有 `size`、`sourceSkill` 和 `producerRunId`（`src/shared/contracts/artifact.ts:14-27`），但仅凭 `producerRunId` 不能可靠显示 child/root 名称；本轮只展示可直接解释的真实元数据。
