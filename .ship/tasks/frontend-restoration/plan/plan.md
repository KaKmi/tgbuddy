# TgBuddy 前端完整还原 Implementation Plan

> **For agentic workers:** 使用 `/ship:dev` 逐 Slice 实施；每个 Slice 独立 RED、GREEN、targeted verify、commit。只有标记为“契约/架构”的 Slice 在开发前执行轻量 `/ship:arch-design`，并按风险决定 review；纯 UI Slice 不单独 review。

**Goal:** 保留全部真实 Agent 闭环，把 Renderer 还原为 Codex Light v3 的轻量纸白/暖炭灰双主题桌面工作台，并补齐自动标题、文件树、文件查看和设置中心 UX。

**Architecture:** `App.tsx` 保留顶层数据与 action 装配，展示逐步迁到 `features/theme|shell|session|conversation|composer|settings|results`。大部分数据继续经现有 `window.tgbuddy`；只有 LLM Session Title 和工作区文件树按独立 Slice 增加最小 Runtime/IPC contract。

**Tech Stack:** Electron 39、React 18、TypeScript、Jotai、Tailwind 3、AI Elements、Playwright Electron、Bun test。

## Global Constraints

- 注释、测试、诊断、文档一律中文；不得使用 `any`。
- 视觉基准固定 1500×900；断点固定 1180/820/640px。
- 桌面关键尺寸：Sidebar 252px、Header 48px、Conversation 720px、Composer 820px、Results 356px、Settings 900×650px。
- fresh userData 默认 `light`；仅支持 `light | dark`，持久化键固定 `tgbuddy-theme`。
- 不复制设计稿 fixture，不恢复 per-tool 三档，不新增假导出、Tool replay 或无法履约的按钮。
- 继续复用 `Conversation`、`Response`、streamdown、真实 atom/event/IPC。
- 每个 Slice 默认不超过 6 个生产文件，只暂存当前 Slice 文件。

## 快速执行路由

| 类型 | Slice | 默认流程 |
|---|---|---|
| UI | FR01–FR10、FR11B、FR12–FR16 | design 确认边界 → dev → targeted test + build/截图；不单独 review |
| 契约/架构 | FR05A、FR11A | 轻量 arch-design → dev → architecture/typecheck/integration；契约或持久化竞争风险较高时才 review |
| 质量门禁 | FR17 | E2E → QA → refactor；只修真实 finding |

UI Slice 复用现有 `window.tgbuddy` 和 Runtime 行为，不得为了对齐原型扩大 contract。若实施时发现必须新增或改变 shared DTO/IPC wire，立即把该 Slice 重新标为“契约/架构”，补一页轻量 arch-design 后继续。

---

### FR01：双主题切换与持久化

**Files:** Create `src/renderer/features/theme/theme-state.ts`, `src/renderer/features/theme/ThemeToggle.tsx`; Modify `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/App.tsx`; Test `tests/theme-state.test.ts`, `tests/e2e/ui-theme.e2e.ts`。

**Interfaces:** `type ThemeName='light'|'dark'`; `readTheme(storage)`; `applyTheme(theme,root)`; `useTheme()`。

- [x] RED：空 storage 为 light，非法值回退，toggle/data-theme，fresh light，重启保持 dark。
- [x] Run: `bun test tests/theme-state.test.ts`; expected FAIL 缺少模块。
- [x] GREEN：移除 `index.html` 写死 `.dark`，映射设计稿 semantic token，接入 ThemeToggle。
- [x] Run: `bun test tests/theme-state.test.ts && bun run typecheck && bun run build && bunx playwright test tests/e2e/ui-theme.e2e.ts`。
- [x] Commit: `b22e3d9 feat(ui): 添加持久化明暗主题`。

### FR02：三栏 AppShell 与 Thread Header

**Files:** Create `src/renderer/features/shell/AppShell.tsx`, `src/renderer/features/conversation/ConversationHeader.tsx`; Modify `src/renderer/App.tsx`, `src/renderer/features/results/ResultsPanel.tsx`; Test `tests/e2e/ui-shell.e2e.ts`。

**Interfaces:** `AppShell({sidebar,main,results,resultsOpen})`; `ConversationHeader({title,running,resultsOpen,onToggleResults})`。

- [ ] RED：真实会话标题、run pill、results-toggle、开关结果区，以及 252/356/48px 计算尺寸。
- [ ] GREEN：App 只持有 `resultsOpen`，Header 只消费 props，Results 接 `open/onClose`。
- [ ] Run: `bun run typecheck && bun run build && bunx playwright test tests/e2e/ui-shell.e2e.ts`。
- [ ] Commit: `feat(ui): add app shell and thread header`。

### FR03：结果区响应式覆盖层

**Files:** Create `src/renderer/features/shell/layout-state.ts`; Modify `src/renderer/features/shell/AppShell.tsx`, `src/renderer/features/results/ResultsPanel.tsx`, `src/renderer/styles.css`; Test `tests/layout-state.test.ts`, `tests/e2e/ui-responsive.e2e.ts`。

**Interfaces:** `resultPresentation(width):'column'|'overlay'`; `sidebarPresentation(width):'full'|'compact'|'hidden'`。

- [ ] RED：1500 column、1180 overlay、820 compact、640 hidden；无横向溢出且 toggle 可达。
- [ ] GREEN：精确实现三个断点；overlay 遮罩、Escape/关闭后焦点返回 toggle。
- [ ] Run: `bun test tests/layout-state.test.ts && bun run build && bunx playwright test tests/e2e/ui-responsive.e2e.ts`。
- [ ] Commit: `feat(ui): make result panel responsive`。

### FR04：Sidebar 品牌与 Workspace 收口

**Files:** Create `src/renderer/features/session/SessionSidebar.tsx`; Modify `src/renderer/App.tsx`; Test `tests/e2e/ui-workspace-sidebar.e2e.ts`。

- [ ] RED：品牌、theme/settings、真实 workspace path、add/mount 错误与“本地模式”底栏。
- [ ] GREEN：移动而不复制 App 侧栏结构和 action，恢复 252px 视觉。
- [ ] Run: `bun run typecheck && bun run build && bunx playwright test tests/e2e/ui-workspace-sidebar.e2e.ts tests/e2e/m2-workspace.e2e.ts`。
- [ ] Commit: `feat(ui): restore workspace sidebar`。

### FR05：Session 搜索、菜单与草稿保护

**Files:** Create `src/renderer/features/session/session-view.ts`, `src/renderer/features/session/SessionActionDialog.tsx`; Modify `src/renderer/features/session/SessionSidebar.tsx`, `src/renderer/components/SessionMenu.tsx`, `src/renderer/App.tsx`; Test `tests/session-view.test.ts`, `tests/e2e/ui-session-actions.e2e.ts`。

**Interfaces:** `hasUnsavedDraft(text,attachments)`、`groupSessions`、`SessionActionDialog`；`type NavigationIntent = {kind:'new-session'} | {kind:'switch-session';sessionId:string} | {kind:'switch-workspace';workspaceId:string}`；`requestNavigation(intent):void`。无草稿立即执行；正文非空白或有附件时打开确认；`stay` 不改 state/IPC，`discard` 清除草稿和附件后只执行一次 intent。

- [ ] RED：unit 固定标题/摘要命中与不命中、置顶优先与 Today 分组、纯空白无草稿、任一附件有草稿；E2E 覆盖 Ctrl/Cmd+N、Popover Escape/焦点、产品内重命名/删除，以及三种 intent 的 stay/discard。
- [ ] GREEN：移除 `window.prompt/confirm`；菜单/Dialog 可键盘操作；无假导出。
- [ ] Run: `bun test tests/session-view.test.ts && bun run build && bunx playwright test tests/e2e/ui-session-actions.e2e.ts`。
- [ ] Commit: `feat(ui): polish session navigation`。

### FR05A：LLM Session Title 生成

**Files:** Create `src/runtime/sessions/session-title-service.ts`, `src/kernel/pi/pi-title-generator.ts`; Modify `src/shared/contracts/session.ts`, `src/runtime/app/agent-runtime.ts`, `src/main/bootstrap/create-application.ts`, `src/renderer/App.tsx`; Test `tests/session-title-service.test.ts`, `tests/e2e/ui-session-title.e2e.ts`。

**Interfaces:** `TitleGenerator.generate({userMessage,channelId,modelId,signal}):Promise<string|null>`；Session 增加可持久化 `titleSource:'default'|'generated'|'user'`。首次 root Run 初始化完成后异步请求一次，只有 `titleSource==='default'` 才写回；Renderer 通过现有 Session catalog 刷新/host event 更新 Header 与 Sidebar。

- [ ] RED：只触发首次 root 消息；清洗引号/换行并限制 24 个中文字符或 60 个 ASCII 字符；Provider 失败、空标题或超时使用首条用户文本安全截断；手动改名先到和生成结果迟到两种竞争都由 `user` 标题获胜；重启恢复。
- [ ] GREEN：参考 Prom 的“默认标题守卫 + 后台生成 + title updated 通知”，但调用必须经过 TgBuddy Runtime/Kernel 边界，不把 Provider 逻辑放 Renderer/Main IPC。
- [ ] Run: `bun test tests/session-title-service.test.ts && bun run check:architecture && bun run typecheck && bun run build && bunx playwright test tests/e2e/ui-session-title.e2e.ts`。
- [ ] Commit: `feat(session): generate title after first message`。

### FR06：Composer 容器与发送闭环

**Files:** Create `src/renderer/features/composer/AgentComposer.tsx`; Modify `src/renderer/App.tsx`; Test `tests/e2e/ui-composer.e2e.ts`。

- [ ] RED：820px、附件、Enter、Shift+Enter、IME 不发送、Stop、排队文案。
- [ ] GREEN：移动现有输入闭环，不持有 IPC，加入 `event.isComposing` 防线。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-composer.e2e.ts tests/e2e/m4-results.e2e.ts`。
- [ ] Commit: `feat(ui): restore agent composer`。

### FR07：轻量 Composer 能力菜单

**Files:** Create `src/renderer/features/composer/capability-menu-state.ts`, `src/renderer/features/composer/CapabilityMenu.tsx`; Modify `src/renderer/features/composer/AgentComposer.tsx`, `src/renderer/App.tsx`; Test `tests/capability-menu-state.test.ts`, `tests/e2e/ui-capabilities.e2e.ts`。

**Interfaces:** `type ComposerPopover='mode'|'profile'|'model'|'context'|null`; `openPopover(current,next)`; `onOpenSettings(tab)`。

- [ ] RED：模式/Profile/模型/上下文互斥、toggle/close、外点/Escape、焦点返回；断言 Composer 不渲染 Skill/MCP 工作区级 chip。
- [ ] GREEN：复用现有 Mode/Profile/Model/Context 逻辑；Skill/MCP 继续由真实 Run 能力快照加载，只移除 Composer 与工作区级配置入口。
- [ ] Run: `bun test tests/capability-menu-state.test.ts && bun run build && bunx playwright test tests/e2e/ui-capabilities.e2e.ts`。
- [ ] Commit: `feat(ui): add real capability menus`。

### FR08：ToolCard 折叠状态机

**Files:** Create `src/renderer/components/tool-card-state.ts`; Modify `src/renderer/components/ToolCard.tsx`; Test `tests/tool-card-state.test.ts`, `tests/tool-activity.test.ts`。

**Interfaces:** `initialToolOpen(status)`; `nextToolOpen(previousStatus,status,manualOpen)`。

- [ ] RED：waiting/running/error 打开，success/denied/unknown 关闭，running→success 收起，同状态保留手动值。
- [ ] GREEN：仅响应 status transition，补 running/success 文本 meta，保留 Blob/child 展示。
- [ ] Run: `bun test tests/tool-card-state.test.ts tests/tool-activity.test.ts && bun run typecheck`。
- [ ] Commit: `fix(ui): enforce tool card state transitions`。

### FR09：Inline 权限与 pending toast

**Files:** Modify `src/renderer/components/PermissionBanner.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`; Test `tests/e2e/ui-permission-surface.e2e.ts`。

- [ ] RED：双主题允许/拒绝、规则候选、neverPersist、toast 跳转，并同跑现有权限 E2E。
- [ ] GREEN：只替换 token/层级，不改 response payload 与 `jumpToPendingPermission()`。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-permission-surface.e2e.ts tests/e2e/m2-permission.e2e.ts`。
- [ ] Commit: `feat(ui): polish permission surfaces`。

### FR10：Context、Compaction 与系统标记

**Files:** Modify `src/renderer/components/ContextUsagePanel.tsx`, `src/renderer/components/CompactionStatus.tsx`, `src/renderer/components/CompactionDivider.tsx`, `src/renderer/components/SystemMarker.tsx`, `src/renderer/styles.css`; Test `tests/e2e/ui-context.e2e.ts`。

- [ ] RED：85%、立即压缩、稍后、排队、完成摘要展开和双主题。
- [ ] GREEN：仅迁移视觉 token/层级，继续显示真实 ledger。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-context.e2e.ts tests/e2e/m1-runtime.e2e.ts`。
- [ ] Commit: `feat(ui): unify context timeline`。

### FR11A：工作区只读文件树 contract（契约/架构）

**Files:** Create `src/shared/contracts/workspace-file.ts`, `src/runtime/workspaces/workspace-file-reader.ts`, `src/infrastructure/workspace/node-workspace-file-reader.ts`; Modify `src/shared/contracts/ipc.ts`, `src/main/ipc.ts`, `src/preload/index.ts`; Test `tests/workspace-file-reader.test.ts`, `tests/e2e/ui-workspace-files.e2e.ts`。

**Interfaces:** `WorkspaceFileEntry {name;relativePath;kind:'file'|'directory';size?:number;modifiedAt?:string}`；`workspace.files.list({workspaceId,relativePath,depth})` 只读取当前 mount 内的相对路径，拒绝越界、符号链接逃逸和失效 mount；单次最多 500 项、默认深度 2，返回截断标记而非无限递归。

- [ ] 先执行轻量 arch-design：确认 mount owner、路径校验、条目上限、错误 DTO 与刷新语义；不引入 watcher、编辑器或全盘索引。
- [ ] RED：目录/文件排序、空目录、500 项截断、mount 缺失、`..` 越界、符号链接逃逸、读取失败映射。
- [ ] GREEN：Runtime 只依赖 reader port；Node adapter 读取文件系统；Main 只校验输入并转发；Preload 暴露 typed API。
- [ ] Run: `bun test tests/workspace-file-reader.test.ts && bun run check:architecture && bun run typecheck && bun run build`。
- [ ] Commit: `feat(workspace): expose safe file tree reads`。

### FR11B：Artifact、工作区文件树与查看器（UI）

**Files:** Create `src/renderer/features/results/WorkspaceFileTree.tsx`, `src/renderer/features/results/FileViewer.tsx`; Modify `src/renderer/features/results/ResultsPanel.tsx`, `src/renderer/features/results/results-view.ts`, `tests/e2e/m4-results.e2e.ts`; Test `tests/results-view-state.test.ts`, `tests/e2e/ui-results.e2e.ts`。

- [ ] RED：隐藏保持 filter/selection、切 session 清空；产物/工作区 tab；Markdown/代码/图片/CSV 预览；目录展开/筛选/刷新/mount 缺失；查看器 breadcrumb、关闭焦点返回、系统打开；断言不存在“让 Agent 改这份”。
- [ ] GREEN：356px 轻量侧栏；产物按时间组织，工作区消费 FR11A 的真实文件树 contract；查看器只读且按文件类型降级；只展示真实 `size/sourceSkill`，不猜 `producerRunId`。
- [ ] Run: `bun test tests/results-view-state.test.ts && bun run build && bunx playwright test tests/e2e/ui-results.e2e.ts tests/e2e/m4-results.e2e.ts`。
- [ ] Commit: `feat(ui): restore artifact results panel`。

### FR12：设置中心 Dialog 与 tab 路由

**Files:** Create `src/renderer/features/settings/SettingsDialog.tsx`, `src/renderer/features/settings/settings-navigation.ts`; Modify `src/renderer/components/ChannelSettingsPanel.tsx`, `src/renderer/App.tsx`; Test `tests/settings-navigation.test.ts`, `tests/e2e/ui-settings-shell.e2e.ts`。

**Interfaces:** `SettingsTab='general'|'models'|'permissions'|'capabilities'|'appearance'`; `SettingsDialogProps {workspaceId:string|null; initialTab:SettingsTab; theme:ThemeName; onTheme(theme:ThemeName):void; onClose():void}`；`DirtyCloseDecision='discard'|'stay'`。Dialog 持有 activeTab、focus return 与 dirty-close 路由；遮罩、Escape、关闭按钮都调用同一关闭协议。

- [ ] RED：initialTab；900×650；遮罩/Escape；focus trap/return；脏表单切 tab/关闭时 stay 保持内容、discard 清理后关闭。
- [ ] GREEN：本 Slice 先开放真实可用的 General、Models 与 Appearance；General 接启动恢复、新会话默认模式、本地数据目录和脱敏日志导出，不能出现空占位；Session 标题自动生成是固定行为，不提供设置项；Models 暂由旧面板作为内容 owner；Appearance 复用 FR01 主题状态。Permissions/Capabilities 在各自 Slice 完成时才加入导航。
- [ ] Run: `bun test tests/settings-navigation.test.ts && bun run build && bunx playwright test tests/e2e/ui-settings-shell.e2e.ts`。
- [ ] Commit: `feat(ui): add settings center shell`。

### FR13：模型、密钥与 Profile 页

**Files:** Create `src/renderer/features/settings/ModelProfileSettings.tsx`, `src/renderer/features/settings/settings-data.ts`; Modify `src/renderer/components/ChannelSettingsPanel.tsx`, `src/renderer/features/settings/SettingsDialog.tsx`; Test `tests/e2e/ui-model-settings.e2e.ts`。

**Interfaces:** `SettingsSnapshot {channels;profiles;tools;skillGroups;mcpServers;mcpStatuses;permissionRules}` 使用 shared contract 的准确字段类型；`SettingsDataState {snapshot:SettingsSnapshot|null; loading:boolean; error:string|null; refresh():Promise<void>}`；`useSettingsData(workspaceId)` 由 SettingsDialog 唯一持有并向 tab 传数据/action。`ModelProfileSettings` 持有 Channel/Profile 表单 state 与 handler。

- [ ] RED：逐项断言 Channel create/update/delete/test；Profile create/update/delete/select；secret 读取始终为空且空值更新不覆盖；脏表单切 tab/关闭确认；loading/error/retry。
- [ ] GREEN：移动而不复制 Channel/Profile state、handler、markup；从旧组件删除对应 owner；所有成功 action 后 `refresh()`，失败保留表单并显示真实错误。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-model-settings.e2e.ts tests/e2e/m3-settings.e2e.ts`。
- [ ] Commit: `refactor(ui): move model settings into tab`。

### FR14：权限规则与 Tool 只读页

**Files:** Create `src/renderer/features/settings/PermissionToolSettings.tsx`; Modify `src/renderer/features/settings/SettingsDialog.tsx`, `src/renderer/features/settings/settings-data.ts`, `docs/06-设计决策.md`; Test `tests/e2e/ui-permission-settings.e2e.ts`, `tests/e2e/m3-settings.e2e.ts`。

**Interfaces:** `PermissionToolSettings({rules,tools,refresh})`；Tool 行只映射 `tool.list()` 的真实 id/name/description/category/default permission 字段，缺失字段不推断。撤销规则调用 `permission.removeRule`，成功后 refresh，失败保持原列表并显示错误。

- [ ] RED：真实规则展示/撤销；工具只读 badge；无 select、无 per-tool 编辑器；撤销失败状态。
- [ ] GREEN：加入 Permissions 导航；实现只读默认与规则列表；删除旧组件中 permission/tool markup 与 handler；同步设计决策中旧三档描述。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-permission-settings.e2e.ts tests/e2e/m3-settings.e2e.ts`。
- [ ] Commit: `feat(ui): add permission and tool overview`。

### FR15：应用级 Skill 管理

**Files:** Create `src/renderer/features/settings/SkillSettings.tsx`; Modify `src/renderer/components/ChannelSettingsPanel.tsx`, `src/renderer/features/settings/SettingsDialog.tsx`, `src/renderer/features/settings/settings-data.ts`; Test `tests/e2e/ui-skill-settings.e2e.ts`。

**Interfaces:** `SkillSettings({groups,loading,error,refresh})`；SettingsDialog/settings-data 持有应用级加载与错误。toggle 等待 `skill.setEnabled` 成功后 refresh；失败不改 snapshot 并显示错误，不做乐观更新。工作区 Skill 如底层仍存在，只标来源，不提供按工作区启用开关。

- [ ] RED：来源分组、应用级开关、toggle 成功刷新/失败回滚、loading/error/retry；切 workspace 不改变启用状态；Composer 无 Skill chip。
- [ ] GREEN：加入统一 Capabilities 导航中的 Skill 分区；移动 Skill state、handler、markup并从旧组件删除。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-skill-settings.e2e.ts tests/e2e/m3-settings.e2e.ts`。
- [ ] Commit: `refactor(ui): move skill settings into tab`。

### FR16：应用级 MCP 管理

**Files:** Create `src/renderer/features/settings/McpSettings.tsx`, `src/renderer/features/settings/McpToolsSection.tsx`; Modify `src/renderer/components/ChannelSettingsPanel.tsx`, `src/renderer/features/settings/SettingsDialog.tsx`, `src/renderer/features/settings/settings-data.ts`; Test `tests/e2e/ui-mcp-settings.e2e.ts`。

**Interfaces:** `McpSettings({servers,statuses,tools,loading,error,refresh,onDirtyChange})` 持有 CRUD 表单；save/delete/connect/disconnect/reconnect 各自显示 pending，成功后统一 refresh servers/status/tools，失败保留表单和上一 snapshot 并显示错误。`McpToolsSection` 只负责真实 discovery 展开。

- [ ] RED：应用级 CRUD、连接/断开/重连、失败保留、工具展开、dirty-close；切 workspace 不改变连接状态；Composer 无 MCP chip。
- [ ] GREEN：加入统一 Capabilities 导航中的 MCP 分区；移动 MCP state、handler、markup；至此 Channel/Profile/Skill/MCP owner 全部迁出，确定删除 `src/renderer/components/ChannelSettingsPanel.tsx` 并清理 import，不保留第二 owner。
- [ ] Run: `bun run build && bunx playwright test tests/e2e/ui-mcp-settings.e2e.ts tests/e2e/m3-settings.e2e.ts`。
- [ ] Commit: `refactor(ui): move mcp settings into tab`。

### FR17：七场景最终 gate

**Files:** Create `tests/e2e/ui-seven-scenes.e2e.ts`, `.ship/tasks/frontend-restoration/qa/checklist.md`; Modify `docs/08-项目进度.md`, `.ship/tasks/frontend-restoration/dev-ledger.md`。

**Evidence:** 固定目录 `.ship/tasks/frontend-restoration/qa/screenshots/`；固定文件 `01-empty-light-1500x900.png`、`02-main-light-1500x900.png`、`03-tools-dark-1500x900.png`、`04-permission-dark-1500x900.png`、`05-context-light-1500x900.png`、`06-sessions-title-light-1500x900.png`、`07-settings-light-1500x900.png`、`08-results-files-light-1500x900.png`、`09-file-viewer-light-1500x900.png`、`10-results-overlay-1180x900.png`。

- [ ] RED：测试先断言首个 evidence 文件存在，当前因缺少 `01-empty-light-1500x900.png` 确定失败；随后改为到达场景、完成语义断言与键盘路径、禁用动画、截图，再断言文件存在。
- [ ] 场景断言：empty 有新会话空态且 Tab 到 composer；main 有真实标题且结果 toggle 可开关；tools 覆盖 waiting/running/success/error 且 Enter 折叠；permission 覆盖 allow/deny 且 Escape 返回触发点；context 显示 85% 与 compaction 动作；sessions 覆盖自动标题、搜索/菜单/Ctrl+N 与草稿保护；settings 覆盖全部已开放 tab、focus trap 与 Escape/dirty-close；results-files 覆盖产物/工作区、四类预览与文件树；file-viewer 覆盖 breadcrumb、降级和焦点返回。
- [ ] 响应式补充：1180 下 Results 为 overlay、关闭后焦点返回 toggle、页面无横向溢出。
- [ ] GREEN：只修测试暴露的真实缺口，不放宽断言、不加生产 scene flag；checklist 必须逐条关联验收 1–15、十张截图、light/dark、键盘和断点证据后才完成。
- [ ] Run: `bun test && bun run check:architecture && bun run typecheck && bun run build && bunx playwright test`；已知 Vite 约 690KB warning 仍保留。
- [ ] Commit: `test(ui): verify seven restored frontend scenes`。

## Spec Coverage

- 验收 1–2：FR01–FR03；验收 3：FR04–FR05；验收 4：FR02–FR03；验收 5–6：FR06–FR07；验收 7–8：FR08–FR10；验收 9：FR11A–FR11B；验收 10：FR12–FR16；验收 11–13：FR17；验收 14：FR04–FR05、FR07、FR12；验收 15：FR05A。FR17 最终复核验收 1–15，不替代各 Slice 的独立 RED/GREEN。
