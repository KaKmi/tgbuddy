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
