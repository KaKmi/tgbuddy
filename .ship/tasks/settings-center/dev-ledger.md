# Settings Center Dev Ledger

Story SC01: “按 V3 原型还原设置中心” — complete

- Commit: `0201b1c feat(ui): restore settings center`
- Files: `src/renderer/App.tsx`, `src/renderer/features/settings/ChannelSettingsPanel.tsx`, `src/renderer/features/settings/settings-preferences.ts`, `src/renderer/styles.css`, `tests/settings-preferences.test.ts`, `tests/e2e/m3-settings.e2e.ts`, `tests/e2e/settings-center.e2e.ts`
- Produces: 五页设置导航；应用级 Skill/MCP 管理；Provider/Profile 编辑；权限规则撤销；双主题外观；可持久化启动、默认权限与模型分工偏好。
- Verification: unit 374/374；architecture；typecheck；build；Settings Electron E2E 7/7 + shell/visual E2E 1/1。
- Review: 按用户快速路径跳过独立 peer review；完成截图视觉自检与轻量 refactor。
- Concerns: Settings 子页面后续随 Renderer owner 收口拆为独立 feature 文件；当前不改变 Runtime 对 child/compaction 模型偏好的消费方式。
