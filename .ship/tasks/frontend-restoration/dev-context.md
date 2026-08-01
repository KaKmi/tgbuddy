# Frontend Restoration Dev Context

## Test Command

每个 UI Slice 运行 targeted Bun test、`bun run typecheck`、`bun run build` 与对应 Electron E2E；全部 Slice 完成后运行 `bun test`、architecture、typecheck、build、全量 Playwright。

## Code Conduct

- 注释、测试、诊断和文档使用中文；不使用 `any`。
- Renderer 不依赖 Main、Runtime、Kernel、Infrastructure 或 Node runtime。
- 每个 Slice 一个主要行为，先 RED 再 GREEN，只暂存当前 Slice 文件。
- 纯 UI 走快速验证，不单独 review；shared DTO/IPC/持久化变化才补 arch-design 并按风险 review。

## Pattern References

### FR01：双主题切换与持久化

- `src/renderer/styles.css`
  - 现有 shadcn semantic token 与 AI Elements 的公共样式契约。
  - 保留 HSL 三元组和 Tailwind alpha 兼容，只替换 light/dark token 与主题选择器。
- `src/renderer/App.tsx`
  - 顶层 Renderer 状态与设置入口 owner；主题暂由 App 持有，后续 FR12 传入设置中心。
- `tests/e2e/support/electron-fixture.ts`
  - fresh userData 与同目录重启模式，用于验证本地主题持久化。

## Waves

- UI Slice 默认顺序执行，减少 `App.tsx` 与 `styles.css` 文件重叠。
- FR05A、FR11A 是独立契约波次，开发前单独进行轻量 arch-design。
- FR17 统一执行 E2E、QA 和证据截图；随后进入 refactor。
