# Frontend Restoration Dev Ledger

Story FR01: “双主题切换与持久化” — complete
  Commits: b22e3d9
  Files: `.ship/tasks/frontend-restoration/dev-context.md`, `src/renderer/App.tsx`, `src/renderer/features/theme/ThemeToggle.tsx`, `src/renderer/features/theme/theme-state.ts`, `src/renderer/index.html`, `src/renderer/styles.css`, `tests/theme-state.test.ts`, `tests/e2e/ui-theme.e2e.ts`
  Produces: `ThemeName = 'light' | 'dark'`; `readTheme(storage): ThemeName`; `writeTheme(storage, theme): void`; `applyTheme(root, theme): void`; `useTheme(): {theme; toggle}`; `ThemeToggle`
  Verification: `bun test tests/theme-state.test.ts` 4/4；`bun run typecheck`；`bun run build`；`bunx playwright test tests/e2e/ui-theme.e2e.ts` 1/1
  Review: 按用户快速路径跳过；纯 Renderer UI，无 shared DTO/IPC/存储语义变化
  Concerns: Vite 主 chunk 745.90KB 警告为既有基线，未调整阈值
