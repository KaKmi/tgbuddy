# Frontend Restoration Dev Ledger

Story FR01: “双主题切换与持久化” — complete
  Commits: b22e3d9
  Files: `.ship/tasks/frontend-restoration/dev-context.md`, `src/renderer/App.tsx`, `src/renderer/features/theme/ThemeToggle.tsx`, `src/renderer/features/theme/theme-state.ts`, `src/renderer/index.html`, `src/renderer/styles.css`, `tests/theme-state.test.ts`, `tests/e2e/ui-theme.e2e.ts`
  Produces: `ThemeName = 'light' | 'dark'`; `readTheme(storage): ThemeName`; `writeTheme(storage, theme): void`; `applyTheme(root, theme): void`; `useTheme(): {theme; toggle}`; `ThemeToggle`
  Verification: `bun test tests/theme-state.test.ts` 4/4；`bun run typecheck`；`bun run build`；`bunx playwright test tests/e2e/ui-theme.e2e.ts` 1/1
  Review: 按用户快速路径跳过；纯 Renderer UI，无 shared DTO/IPC/存储语义变化
  Concerns: Vite 主 chunk 745.90KB 警告为既有基线，未调整阈值

Story FR02: “三栏 AppShell 与 Thread Header” — complete
  Commits: 255fce2
  Files: `src/renderer/App.tsx`, `src/renderer/features/shell/AppShell.tsx`, `src/renderer/features/conversation/ConversationHeader.tsx`, `src/renderer/features/results/ResultsPanel.tsx`, `tests/e2e/ui-shell.e2e.ts`
  Produces: `AppShell`; `ConversationHeader({title,running,resultsOpen,onToggleResults})`; `ResultsPanel(open,onClose)`；252px 左栏、48px Header、356px 结果区
  Verification: RED 缺少 `app-shell`；`bun run check:architecture`；`bun run typecheck`；`bun run build`；`bunx playwright test tests/e2e/ui-shell.e2e.ts` 1/1
  Review: 按用户快速路径跳过；纯 Renderer UI，无 shared DTO/IPC/存储语义变化
  Concerns: 响应式 overlay 与焦点恢复留给 FR03；Vite 主 chunk 748.52KB 警告为既有基线

Story FR03: “结果区响应式覆盖层” — complete
  Commits: 59fce31
  Files: `src/renderer/App.tsx`, `src/renderer/features/shell/AppShell.tsx`, `src/renderer/features/shell/layout-state.ts`, `src/renderer/features/conversation/ConversationHeader.tsx`, `src/renderer/features/results/ResultsPanel.tsx`, `tests/layout-state.test.ts`, `tests/e2e/ui-responsive.e2e.ts`
  Produces: `resultPresentation(width)`；`sidebarPresentation(width)`；1180px 结果覆盖层、820px 紧凑侧栏、640px 隐藏侧栏；遮罩/Escape 关闭并恢复焦点
  Verification: RED 缺少 layout-state 与遮罩；`bun test tests/layout-state.test.ts` 2/2；`bun run check:architecture`；`bun run typecheck`；`bun run build`；FR02/FR03 Electron E2E 2/2
  Review: 按用户快速路径跳过；纯 Renderer 布局与无障碍交互
  Concerns: 640px 下能力入口收口留给 FR07；Vite 主 chunk 749.36KB 警告为既有基线

Story FR04: “Sidebar 品牌与 Workspace 收口” — complete
  Commits: 0846a13
  Files: `src/renderer/App.tsx`, `src/renderer/features/session/SessionSidebar.tsx`, `tests/e2e/ui-workspace-sidebar.e2e.ts`
  Produces: `SessionSidebar` 成为 Workspace/Session 目录唯一展示 owner；TgBuddy 品牌、本地模式、真实 mount path 与丢失恢复提示
  Verification: RED 缺品牌和 mount-error 节点；`bun run check:architecture`；`bun run typecheck`；`bun run build`；Workspace 新旧 Electron E2E 4/4
  Review: 按用户快速路径跳过；只移动 Renderer owner，复用既有 Workspace IPC
  Concerns: 搜索、菜单、草稿保护在 FR05；Vite 主 chunk 752.09KB 警告为既有基线

Story FR05: “Session 搜索、菜单与草稿保护” — complete
  Commits: 7250290
  Files: `src/renderer/App.tsx`, `src/renderer/features/session/SessionSidebar.tsx`, `src/renderer/features/session/SessionMenu.tsx`, `src/renderer/features/session/SessionActionDialog.tsx`, `src/renderer/features/session/session-view.ts`, `tests/session-view.test.ts`, `tests/e2e/ui-session-actions.e2e.ts`
  Produces: `NavigationIntent`；`hasUnsavedDraft`；`filterSessions`；`groupSessions`；`SessionActionDialog`；三类导航 stay/discard 门卫
  Verification: RED 缺 view 模块、原生弹窗和无草稿门卫；unit 3/3；`bun run check:architecture`；`bun run typecheck`；`bun run build`；Electron E2E 2/2
  Review: 按用户快速路径跳过；Renderer 内状态与交互，无 IPC contract 变化
  Concerns: 自动标题进入 FR05A；Vite 主 chunk 756.59KB 警告为既有基线

Story FR05A: “LLM Session Title 生成” — complete
  Commits: de6fa19
  Files: Session contract/commands、Runtime title service + port、pi title generator、Composition Root、SQLite 017 migration/repository、targeted tests/E2E/spike evidence
  Produces: `titleSource:'default'|'generated'|'user'`；`TitleGenerator` port；`SessionTitleService`；首次 root `run_start` 后旁路生成、8s 超时回退、手动改名竞争守卫
  Verification: RED 缺 title service；unit/targeted 24/24；architecture；typecheck；build；Electron E2E 1/1；真实 DeepSeek `probe`；packaged SQLite 13 scenarios 全过
  Review: 契约级 Slice 按用户规则做轻量 arch-design + 短静态自检；修正触发点为真实 `run_start`，无 unresolved finding
  Concerns: 跨 shared/Runtime/Kernel/SQLite/Composition Root 的原子纵向能力无法压到 6 个生产文件；拆开会产生不可运行的半契约，因此本 Slice 例外超过尺寸护栏

Story FR05B: “Provider 品牌图标预置” — complete
  Commits: d780f91
  Files: `provider-brand.ts`, `ProviderBrandIcon.tsx`, `ChannelSettingsPanel.tsx`, `tests/provider-brand.test.ts`
  Produces: DeepSeek/Anthropic 本地矢量品牌图形；Compatible 与本地网关中性 API 图标；独立连接状态点
  Verification: unit 2/2；architecture；typecheck；build；Settings Electron E2E 7/7
  Review: 按用户快速路径跳过；纯 Renderer 小 UI
  Concerns: FR14 设置 Models 重构必须复用本组件，不再创建第二套 Provider 标识

Story SC01: “按 V3 原型还原设置中心” — complete（按用户反馈提前实施）
  Commits: 0201b1c
  Files: `src/renderer/App.tsx`, `src/renderer/features/settings/ChannelSettingsPanel.tsx`, `src/renderer/features/settings/settings-preferences.ts`, `src/renderer/styles.css`, `tests/settings-preferences.test.ts`, `tests/e2e/m3-settings.e2e.ts`, `tests/e2e/settings-center.e2e.ts`
  Produces: 900×650 设置 Dialog；通用/模型/工具与权限/能力/外观导航；应用级 Skill/MCP 管理；Provider/Profile 编辑；权限规则撤销；主题和本地偏好交互
  Verification: `bun test` 374/374；architecture；typecheck；build；Settings Electron E2E 7/7 + shell/visual E2E 1/1；明亮主题截图 2 张
  Review: 按用户快速路径跳过独立 peer review；完成视觉 QA 与轻量 refactor
  Concerns: 原计划 FR12–FR16 的 focus trap、dirty-close 与按 feature 文件物理拆分仍由对应 Slice 收口；SC01 不把这些计划项伪标完成

Story VP01: “浅色界面与结果区视觉收口” — complete（用户反馈驱动）
  Commits: 6772ead
  Files: 自绘窗口 Toolbar 与 IPC、Session hover preview、ContextUsagePanel、ToolCard/Response 主题样式、ResultsPanel、相关 E2E、`design-qa.md`
  Produces: 无原生黑色标题栏的主题化窗口；Codex 式会话悬停摘要；不展示 cost 的上下文面板；按原型组织的产物/工作区双视图、筛选、预览卡和分组列表
  Verification: `bun test` 377/377；architecture；typecheck；build；Renderer/Electron targeted E2E 15/15；结果区追加复验 2/2；参考图与实现截图同批视觉对照通过
  Review: 按用户快速开发要求跳过独立 peer review；未改 Runtime/存储业务契约，仅增加窗口控制 IPC
  Concerns: 权限 UI、空 Workspace 首条发送自动建会话、child Agent 进度展示按用户要求不在本 Slice 实施
