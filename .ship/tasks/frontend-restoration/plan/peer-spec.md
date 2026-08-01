# TgBuddy 前端完整还原：独立调查规格

> **2026-08-01 V3 变更提示：** 本 Peer Spec 是 Codex Light v2 的独立输入。后续用户决策以 `spec.md`、`plan.md` 和 `designs/tgbuddy-codex-light-v3/` 为准：移除 Composer 的 Skill/MCP chip 和“让 Agent 改这份”，新增应用级能力、LLM Session Title、工作区文件树与文件查看器。

> 独立 peer 调查，未读取 host 的 `spec.md`。  
> 调查基线：分支 `codex/m4-m6`，HEAD `7687fab`。  
> 视觉对照：`designs/tgbuddy-codex-light-v2/TgBuddy Codex Light v2.html` 及同目录 CSS/JSX。  
> UI、状态与交互事实源：`tgbuddy-mockup/TgBuddy 交互原型.dc.html`。

## 1. 结论

这不是“从零写一套前端”，而是把已经接通真实 Runtime/IPC 的 Renderer 收敛为一套完整、可操作、可回归的产品界面。当前生产代码已经具备会话、Workspace、流式消息、Tool、权限、压缩、附件、Artifact、Profile、Skill、MCP 与单层 child 的真实交互；主要缺口集中在视觉系统、应用壳、能力入口、设置中心、结果区可开关/响应式，以及缺少面向七个原型场景的视觉回归。

实现应采用以下优先级：

1. 交互语义、状态与约束服从原交互原型和已定设计决策；原型明确列出七个场景（`tgbuddy-mockup/TgBuddy 交互原型.dc.html:1265-1271`），对应说明位于 `tgbuddy-mockup/TgBuddy 交互原型.dc.html:1273-1280`。
2. 视觉语言服从 Codex Light v2：纸白亮色为默认、暖炭灰暗色、低装饰密度、三栏和 252/356px 固定侧栏（`designs/tgbuddy-codex-light-v2/styles.css:1-65`、`designs/tgbuddy-codex-light-v2/styles.css:117-140`、`designs/tgbuddy-codex-light-v2/styles.css:359-366`）。
3. 参考稿里的假数据和旧产品规则不能覆盖当前真实能力。Light v2 自己也说明其来源包含原型与当前客户端（`designs/tgbuddy-codex-light-v2/README.md:10-24`）。
4. 每个 Slice 必须保留真实 `window.tgbuddy` 调用，禁止用本地 mock state 或硬编码 fixture 替代已经存在的 IPC 闭环。

## 2. 已调查入口、调用链与消费者

### 2.1 Renderer 入口与状态链

- `src/renderer/index.html:1-16` 是页面入口，目前把根节点写死为 `.dark`，因此 `styles.css` 虽有亮色变量，产品仍无法切换亮暗主题。
- `src/renderer/main.tsx:14-25` 在 Jotai Provider 内常驻挂载全局流事件监听，再渲染 `App`；改壳和路由时不能卸载监听器。
- `src/renderer/App.tsx:64-102` 同时拥有 Session、Workspace、Channel、Profile、输入、设置开关、附件等状态；`src/renderer/App.tsx:116-168` 通过 Preload 加载真实 Session、Run、Channel、Profile 和 Workspace。
- 发送链为输入/附件草稿 → `window.tgbuddy.agent.send`（`src/renderer/App.tsx:226-258`）→ 全局流监听 → Jotai 状态；消息、工具、权限、Plan、ask_user 和 marker 的消费者集中在 `src/renderer/App.tsx:519-592`。
- Artifact 链为 Session/Run → `window.tgbuddy.artifact.list/preview/open`（`src/renderer/features/results/ResultsPanel.tsx:44-76`、`src/renderer/features/results/ResultsPanel.tsx:147-188`）→ 只读预览/“让 Agent 改这份”。
- 设置链已经通过同一 Preload API 提供 `permission.rules/removeRule`、Channel、Profile、Tool、Skill 和 MCP（`src/shared/contracts/ipc.ts:298-359`），因此设置中心重做不需要另造状态源。

### 2.2 现有自动验收链

- M1 E2E 已覆盖流式恢复、Stop、Tool 回放、自动压缩/排队、编辑重发和扁平克隆（`tests/e2e/m1-runtime.e2e.ts:26-126`）。
- Workspace E2E 已覆盖隔离切换与 Mount 丢失恢复（`tests/e2e/m2-workspace.e2e.ts:53-103`）。
- 权限 E2E 已覆盖 inline 允许/拒绝、高危模态、neverPersist 与规则跨重启（`tests/e2e/m2-permission.e2e.ts:31-105`）。
- Plan/ask_user E2E 已覆盖计划批准、计划模式拒绝副作用和结构化回答（`tests/e2e/m2-plan-askuser.e2e.ts:21-81`）。
- 设置 E2E 已覆盖 Channel CRUD/测试、模型选择、Skill 开关和 MCP 调用（`tests/e2e/m3-settings.e2e.ts:30-154`）。
- M4 E2E 已覆盖附件回显、Artifact 预览与“让 Agent 改这份”（`tests/e2e/m4-results.e2e.ts:15-51`）。
- 现有 QA 报告只把截图列作人工比对素材，没有像素或布局断言（`.ship/tasks/tgbuddy-vertical-slices/qa/m4m6-qa/report.md:20-33`），所以视觉退化仍无自动防线。

## 3. 当前已有能力

### 3.1 应保留而非重写的真实交互

- Workspace picker 已能列出、选中和添加工作区，并显示 Mount 不可用状态（`src/renderer/App.tsx:352-427`）。
- Session 已能新建、搜索、按置顶/今天/七天内/更早分组、选择、重命名、置顶、归档和删除（`src/renderer/App.tsx:430-503`、`src/renderer/features/session/SessionMenu.tsx:29-84`）。
- 空状态已有三个可点击样例，点击后新建会话并预填（`src/renderer/features/session/SessionSamples.tsx:1-46`）。
- 输入区已有附件、Enter 发送、Shift+Enter 换行、发送/停止、压缩时排队（`src/renderer/App.tsx:599-688`）。
- Tool 已区分 waiting/running/success/error/denied/unknown，120ms 授权优先规则由 Listener 保证（`src/renderer/hooks/useGlobalAgentListeners.ts:75-113`），卡片支持折叠、八行预览和完整输出（`src/renderer/components/ToolCard.tsx:100-229`）。
- 权限已有 inline 卡、高危模态、拒绝理由、持久化粒度和 Esc 拒绝（`src/renderer/components/PermissionBanner.tsx:27-126`、`src/renderer/components/PermissionModal.tsx:25-159`）。
- 上下文面板已展示分类 token、Run 账本、85% 阈值和手动压缩（`src/renderer/components/ContextUsagePanel.tsx:46-174`）。
- 结果区已具备时间分段、类型筛选、只读预览、默认应用打开与让 Agent 修改（`src/renderer/features/results/ResultsPanel.tsx:78-190`）。

### 3.2 已经接近原型、只需主题化的组件

- `ToolCard` 的 11px 圆角、720px 最大宽、2px 状态条、低噪成功态与原型数值已经逐项对齐（`src/renderer/components/ToolCard.tsx:1-18`、`src/renderer/components/ToolCard.tsx:107-170`）。
- 高危模态的 520px、背景、阴影和布局已经接近原型（`src/renderer/components/PermissionModal.tsx:55-105`；原型 `tgbuddy-mockup/TgBuddy 交互原型.dc.html:701-720`）。
- 上下文面板宽 396px、位置、用量条与原型结构一致（`src/renderer/components/ContextUsagePanel.tsx:64-96`；原型 `tgbuddy-mockup/TgBuddy 交互原型.dc.html:512-549`）。

## 4. 明确缺口

### 4.1 P0：主题和应用壳不完整

1. 根节点固定 `.dark`，没有主题状态、持久化或设置入口（`src/renderer/index.html:2-3`）。Light v2 要求默认亮色并在 `localStorage` 保留切换（`designs/tgbuddy-codex-light-v2/app.jsx:1-22`）。
2. 当前布局直接以全屏 flex 开始（`src/renderer/App.tsx:309-310`），没有主窗口顶部 Thread 标题、Run 状态、结果区开关；Light v2 明确提供这些结构（`designs/tgbuddy-codex-light-v2/app.jsx:41-50`）。
3. 侧栏当前 240px，结果区 288px 且 `lg` 以下直接隐藏（`src/renderer/App.tsx:353-354`、`src/renderer/features/results/ResultsPanel.tsx:80-82`）；视觉参考是 252px/356px，并在窄窗把结果区变成覆盖层而不是消失（`designs/tgbuddy-codex-light-v2/styles.css:131-140`、`designs/tgbuddy-codex-light-v2/styles.css:359-366`、`designs/tgbuddy-codex-light-v2/styles.css:457-476`）。
4. 当前亮色 token 使用纯白，缺少 Light v2 的纸白层级、阴影、暖色文本和完整语义色（`src/renderer/styles.css:28-56` 对比 `designs/tgbuddy-codex-light-v2/styles.css:1-35`）。

### 4.2 P0：输入区缺少能力入口

当前输入区只有 Mode、Model、Context（`src/renderer/App.tsx:599-618`），已定设计要求“模式 / 专家 / 技能 / 连接器”四个入口，右侧另有模型（`docs/06-设计决策.md:181-185`）。Light v2 已给出 Profile/Skill/MCP popover 的交互结构（`designs/tgbuddy-codex-light-v2/components.jsx:108-162`），但生产实现必须从现有 Profile、Skill、MCP API 读取真实状态，而不能复制 `data.jsx` 假数据。

验收含义：

- 模式选择继续调用 `plan.setMode`，不能变成本地展示状态。
- 专家入口应选择真实 Profile，并写回 SessionMeta；现有模型菜单已经能把 Profile/Channel/Model 写回 Session（`src/renderer/App.tsx:767-861`），应复用而不是制造第二份选择逻辑。
- Skill/MCP 入口至少能展示当前 Run 可用能力与连接/启用状态，并提供进入对应设置页的导航；若允许开关 Skill，应调用 `skill.setEnabled`。
- 所有 popover 支持再次点击、外部点击和 Escape 关闭，互斥打开；打开 Context 时关闭其它菜单。原交互原型以单一 `menu` + `contextOpen` 状态实现互斥（`tgbuddy-mockup/TgBuddy 交互原型.dc.html:1413-1424`）。

### 4.3 P0：结果区不是完整第三栏

- 目前结果区没有关闭按钮，也没有从 Header 恢复的开关（`src/renderer/features/results/ResultsPanel.tsx:80-106`）。原型和 Light v2 都要求可开关（`tgbuddy-mockup/TgBuddy 交互原型.dc.html:192`、`designs/tgbuddy-codex-light-v2/app.jsx:44-50`）。
- 当前选中 Artifact 后把预览固定在栏底，参考稿把预览作为栏内的主要内容，列表仍可滚动（`src/renderer/features/results/ResultsPanel.tsx:107-190` 对比 `designs/tgbuddy-codex-light-v2/components.jsx:215-230`）。
- 当前空态只有一句“会出现在这里”（`src/renderer/features/results/ResultsPanel.tsx:107-111`），交互事实要求解释“左边是过程、右边是结果”（`docs/06-设计决策.md:142-149`），原型还列出文档、代码、图片、数据四类说明（`tgbuddy-mockup/TgBuddy 交互原型.dc.html:1560-1565`）。
- Artifact 条目目前只显示名称、kind、时间，未展示扩展名视觉锚点、大小/来源；已定设计要求标注 root/Skill/child 产生者（`docs/06-设计决策.md:15-23`）。如果现有 `ArtifactRef` 不足以提供来源，先展示 contract 中真实存在的元数据并记录后续 contract 缺口，不得从文件名猜造。

### 4.4 P0：设置不是设置中心

当前 `ChannelSettingsPanel` 是 420px 右抽屉，Channel、Profile、Skill、MCP 全堆在一条长滚动流中（`src/renderer/features/settings/ChannelSettingsPanel.tsx:379-416`、`src/renderer/features/settings/ChannelSettingsPanel.tsx:741-934`）。参考稿是约 900×650 的居中设置中心、左侧导航、独立内容页（`designs/tgbuddy-codex-light-v2/styles.css:394-407`）。

设置中心必须包含并真实接通：

- 模型与密钥/Profiles：保留现有 CRUD 与连接测试。
- 权限规则：调用 `permission.rules/removeRule` 展示、撤销真实规则。
- Tool：只读展示内置分类/默认权限。
- Skill：按来源分组、工作区切换刷新、真实开关。
- MCP：服务状态、连接/断开、编辑/删除、工具展开。
- 外观：亮色/暗色选择。

### 4.5 P1：Sidebar、时间线与细节交互未收口

- Sidebar 缺少品牌区、主题按钮、本地服务状态；Light v2 给出完整结构（`designs/tgbuddy-codex-light-v2/components.jsx:67-103`）。
- Search 文案只写“搜索会话”，Light v2 说“搜索会话与产物”，但当前数据链只过滤 Session title（`src/renderer/App.tsx:437-452`）。除非新增真实 Artifact 索引搜索，不得仅改文案造成虚假能力。
- 会话菜单使用原生 `window.prompt/confirm`（`src/renderer/features/session/SessionMenu.tsx:61-79`），与统一 popover/dialog 视觉不一致；还缺少“以此为起点新建会话”和导出入口。前者已有消息级真实行为，后者无现成 IPC，不能放一个假按钮。原型菜单清单见 `tgbuddy-mockup/TgBuddy 交互原型.dc.html:1550-1553`。
- 对话区没有 Thread header，assistant 正文也没有参考稿的品牌 marker；系统标记、Tool、权限结构已有，重点是主题化并维持信息层级。
- Tool 的 waiting/error 默认展开和 running 完成自动收起需要复核。当前 `open` 只在首次渲染按 `status === 'error'` 初始化（`src/renderer/components/ToolCard.tsx:100-104`），这不满足已定“等待授权展开、执行中展开、完成自动收起”（`docs/06-设计决策.md:43-52`）。
- `PermissionBanner` 文件头仍标记“临时 UI”（`src/renderer/components/PermissionBanner.tsx:1-10`），视觉应纳入本轮收口，但不能改变权限决策语义。

### 4.6 P1：响应式、键盘与可访问性无统一契约

- 生产布局没有与 Light v2 对等的 1180/820/640px 行为；参考规则是结果区覆盖、侧栏变窄、能力 chip 收缩、最终隐藏侧栏（`designs/tgbuddy-codex-light-v2/styles.css:457-476`）。
- 已有 Enter/Shift+Enter、模态 Esc、滚动到底等局部键盘行为，但没有全局新会话快捷键、popover Esc/focus return 和 Dialog focus trap。
- 不得只靠 hover 暴露消息编辑动作；键盘 focus 时也必须可见。当前用户消息动作已经用了 `focus-within`（`src/renderer/App.tsx:1113-1142`），这一防线应保留。

## 5. 权限模型冲突：必须按当前产品裁决

Light v2 的 Tool 设置页展示 per-tool 三档 `<select>`（`designs/tgbuddy-codex-light-v2/components.jsx:235-247`），原交互原型也曾展示三档设置（`tgbuddy-mockup/TgBuddy 交互原型.dc.html:1426-1437`）。但当前产品已经明确删除 per-tool 三档可编辑设置，工具页只读；现有 E2E 直接断言 `tool-row` 数量为 0（`tests/e2e/m3-settings.e2e.ts:79-96`）。

因此本任务的裁决是：

- 可以复用设置中心的窗口形态、左导航、状态点、卡片密度和信息层级。
- 不得恢复 per-tool allow/ask/deny 编辑器，不得新增写入接口。
- Tool 页显示 `tool.list()` 返回的真实分类与默认行为，只读解释权限模式。
- 可编辑的长期授权放在“权限规则”页，只允许撤销已有规则；新规则仍由 inline 授权流程产生。
- 危险命令 `neverPersist`、高危模态和默认/计划/完全访问三模式保持现有 Runtime 语义。

## 6. 目标交互契约

### 6.1 应用与主题

- 首次启动默认 Light v2 纸白主题；用户可切换 light/dark，刷新和 Electron 重启后保持。
- Theme 只通过根属性/class + CSS variables 生效；组件不得到处写 `theme ? colorA : colorB`。
- 两套主题都保持侧栏、对话区、结果区的层级，不用粗边框补偿。

### 6.2 三栏与空状态

- 桌面宽屏：252px Sidebar + 自适应对话 + 356px Results。
- Header 显示 Session title、真实 Run 状态以及结果区开关。
- 结果区关闭后对话区扩展；再次打开恢复选中项和筛选状态。
- 无 Session 时保留三个任务样例和当前权限模式；结果区同时展示解释型空态。

### 6.3 会话与 Workspace

- Workspace picker、添加、隔离和 Mount 错误行为不变。
- 会话分组、搜索、菜单动作继续调用真实 API；菜单改为统一组件后，外部点击/Escape 关闭并把焦点还给触发器。
- 新会话按钮与 `Ctrl/Cmd+N` 触发同一 action；运行中的输入与当前附件不能被静默丢弃。

### 6.4 对话与输入

- 消息、Markdown、流式正文继续复用 `Conversation`/`Response`，不得建第二套 Markdown 渲染链。
- 能力行包含模式、Profile、Skill、MCP、Model、Context；所有菜单显示真实状态。
- Enter 发送、Shift+Enter 换行、Stop、附件、压缩排队和 Artifact 编辑草稿语义保持不变。

### 6.5 Tool、权限、压缩与 child

- Tool waiting/running/error 默认展开，success/denied 默认折叠；running → success 自动折叠；用户手动展开后不被无关 rerender 重置。
- 失败卡显示错误和可执行的重试入口；若没有真实 replay contract，不展示假重试按钮，先记录后端缺口。
- child Tool 保持可识别折叠组，默认只显示状态和摘要。
- inline 权限、底部 pending 跳转条、高危模态、拒绝理由和规则粒度全部保留。
- 压缩倒计时、稍后、进行中占位、输入排队和完成分隔线可被 E2E 操作验证。

### 6.6 结果与设置

- Artifact 时间倒序、类型筛选、“本次任务/更早”、只读预览、打开和让 Agent 修改维持真实行为。
- 设置页导航改变只切 UI 页，不清空未保存表单；关闭/重开时已保存数据重新从 API 刷新。
- Workspace 切换后 Skill 页与能力入口同步刷新。

## 7. 建议切片（每个只交付一个主要行为）

以下顺序避免把“完整还原”做成一个大 UI Story；默认每个 Slice 不超过 6 个生产文件，并各自 RED/GREEN/commit。

| Slice | 单一行为 | 主要生产文件候选 | 关键验证 |
|---|---|---|---|
| FR01 | Light/Dark 主题切换并持久化 | `index.html`、`styles.css`、新 `features/theme/*`、Sidebar 入口 | 首次 light、切 dark、reload 保持；两主题 screenshot |
| FR02 | 三栏 AppShell 与 Thread Header | `App.tsx`、新 `features/shell/*`、`ResultsPanel.tsx` | 252/356px、标题/Run、结果开关 |
| FR03 | Results 在窄窗成为可关闭覆盖层 | Shell/Results 样式 | 1180/820/640 三档不丢入口、不横向溢出 |
| FR04 | Sidebar 品牌/Workspace/服务状态视觉收口 | 新 Sidebar、`App.tsx` | Workspace 切换与 Mount 错误回归 |
| FR05 | Session 搜索/分组/菜单统一交互 | Sidebar Session 子组件、`SessionMenu.tsx` | 搜索、置顶、归档、重命名、删除、Esc/focus |
| FR06 | Composer 容器、附件、发送/停止视觉收口 | 新 Composer、`App.tsx` | Enter/Shift+Enter、附件、Stop、排队回归 |
| FR07 | Profile/Skill/MCP 能力 popover | 新 capability menu、Composer | 真实列表、互斥/外点/Esc、跳设置 |
| FR08 | Tool 折叠状态机与卡片主题化 | `ToolCard.tsx`、Tool view-state helper | waiting/running/error 展开、完成自动收起、八行/完整输出 |
| FR09 | inline 权限与 pending 跳转条视觉收口 | `PermissionBanner.tsx`、App pending toast | 允许/拒绝/总是允许/跳转回归 |
| FR10 | Context/Compaction/系统标记统一时间线 | Context、Compaction、SystemMarker | 85% 倒计时、稍后、排队、完成分隔线 |
| FR11 | Artifact 列表、预览和解释型空态 | `ResultsPanel.tsx`、results view/style | filter/group/preview/open/edit、空态 |
| FR12 | 设置中心窗口与路由壳 | 新 SettingsShell，收缩 `ChannelSettingsPanel` | 900×650、自适应、Esc/遮罩/焦点、页切换不丢状态 |
| FR13 | 模型/密钥/Profile 页迁入设置中心 | Channel/Profile 子页 | 现有 C02/C03/Profile E2E 全过 |
| FR14 | 权限规则 + Tool 只读页 | Permission/Tool 子页 | rules/removeRule；断言无三档编辑器 |
| FR15 | Skill 页迁入与 Workspace 刷新 | Skill 子页 | 分组/开关/切 Workspace 刷新 |
| FR16 | MCP 页迁入 | MCP 子页 | CRUD、连接/断开、错误、工具展开 |
| FR17 | 七场景视觉与键盘回归 | E2E/QA 文件为主 | 七场景语义断言 + light/dark screenshots + tab/Esc |

切片纪律：FR12 只搭设置 Shell，不同时搬四页；FR07 只做能力选择/查看入口，不顺手重构整个 Settings；FR08 不改变 Runtime Tool 事件；FR17 不修此前 Slice 未完成的视觉问题，只建立最终 gate。

## 8. 测试计划

### 8.1 RED 优先

- 为 Theme、Results visibility、Tool open policy、popover reducer 建纯状态测试，先证明当前实现失败。
- 扩展 Playwright Electron E2E，复用现有 fake server/IPC，不在生产代码加“场景模式”。
- 新增七个场景的可复现 fixture 流程：empty、main、tools、perm、context、sessions、settings；每个至少有语义断言、键盘操作和截图证据。
- 对动态时间、流式光标和成本值使用稳定 fixture 或 screenshot mask，禁止为了过图硬编码生产 UI。

### 8.2 每 Slice 最低 gate

- Renderer targeted test。
- `bun run check:architecture`。
- `bun run typecheck`。
- `bun run build`。
- 对应 Electron E2E/运行时截图。
- 最终 FR17 再运行全量 `bun test` 和全部 Electron E2E。

### 8.3 关键断言

- Light/Dark 均无浅色白边、文字对比不足、代码块双重样式。
- 1440×900 对齐主要几何；1180、820、640px 不遮挡发送、Stop、权限和结果开关。
- Tab 顺序可达 Workspace、Session、能力 chips、Composer、Results 与 Settings；Dialog/Popover Esc 行为明确。
- 切 Session/Workspace 后旧 popover、preview、pending 卡和表单状态不串台。
- Run 中、压缩中、等待授权时，不因视觉重构改变可用/禁用语义。

## 9. 非目标与禁止捷径

- 不重做 Runtime、IPC 或数据库，不把用户请求扩大为后端重构。
- 不实现 Team/DAG/parallel/router、市场、导出会话等无现成 contract 的功能。
- 不把 Light v2 的 `data.jsx`、假 Session、假 Artifact 或 `running` 本地布尔量移入生产代码（参考稿假状态见 `designs/tgbuddy-codex-light-v2/app.jsx:1-15`）。
- 不恢复 per-tool 三档权限编辑。
- 不用截图目测代替从 HTML/CSS 提取 token，也不只改颜色而遗漏交互。
- 不通过提高 Vite chunk warning limit 隐藏体积；设置中心拆页应为后续 lazy loading 留边界。
- 不删除或改写现有 AI Elements `Response`/`Conversation` 渲染链。

## 10. 风险与未决事项

1. **文档/代码漂移**：进度文档声称 U08 完成，但 `src/renderer/App.tsx` 仍有 1147 行，`src/renderer/atoms/agent.ts`、`src/renderer/hooks/useGlobalAgentListeners.ts`、`src/main/ipc.ts` 和 `src/shared/types/**` 仍存在；`AGENTS.md:134-137` 又把它们列为 U08 删除对象。前端还原不能假装这一漂移不存在。建议逐 Slice 抽取所触达的 Renderer feature，但不要在 FR01 中夹带一次性大重构；最终由独立架构 Slice 收口 owner。
2. **Light v2 与第一版范围冲突**：主题曾在范围文档中列为延后项（`docs/02-功能范围.md:116-127`），但用户本次明确把 Light v2 作为目标，且核心里程碑已经完成。Theme 可纳入本任务，但不扩展到 system/多彩主题。
3. **Artifact 来源元数据**：设计要求显示产生者，但现有 UI 未消费该字段。实现前必须核对 `ArtifactRef` 是否已有 lineage/source；没有就不要猜，单独升级 contract。
4. **Tool replay**：原型失败卡带重试，但当前 Preload 没有通用 tool replay 命令。没有真实 action 就只保留错误与后续对话修复入口。
5. **设置拆分状态**：当前 `ChannelSettingsPanel` 把多种表单和 refresh/error/busy 状态集中在一个组件。直接复制粘贴成多个页会产生双 owner；应先抽取共享 refresh/状态 owner，再逐页迁移，每次删除原分段。
6. **主题硬编码颜色**：Tool、Permission、Context、Settings 有大量暗色十六进制内联值。仅切根 class 会造成亮色下暗块；每个迁移 Slice 必须改用语义 token，并用双主题截图验收。
7. **截图稳定性**：现有 E2E 依赖真实 Electron、时间和 fake provider。视觉基线要冻结窗口尺寸、字体、时区和动画，必要时禁用动画，否则像素 diff 会抖动。

## 11. 完成定义

本任务只有同时满足以下条件才完成：

- 七个事实源场景在生产 Electron 中都可通过真实交互到达；
- Light v2 默认亮色视觉与暗色变体均完成，不存在固定暗色孤岛；
- 三栏、结果区、能力入口和设置中心的关键交互完整；
- 当前 M1–M4 E2E 行为全部保持；
- 新增主题、结果开关、能力 popover、设置导航、响应式和键盘回归；
- architecture、typecheck、build、全量 test、Electron E2E 全过；
- 对 1440×900 的 empty/main/tools/perm/context/sessions/settings 提供可复现截图证据；
- 不存在假按钮、硬编码业务 fixture、双 owner 或恢复已删除权限模型。
