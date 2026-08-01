# 设置中心 Electron QA

## Verdict

PASS。

## 已验证

- 900×650 居中 Dialog、196px 侧栏、分组行密度和长内容滚动正常。
- 五个 tab 可访问，选中态与 hover 可区分。
- Provider 添加按钮采用列表底部行式布局，无孤立虚线大按钮。
- Provider CRUD/连接测试、Skill 开关、MCP 连接与工具发现保留真实行为。
- “能力”管理按钮进入 Skill/MCP 管理页；Escape 与返回按钮可逐层退出。
- 明亮主题截图无溢出、遮挡或明显错位。

## 证据

- `settings-general.png`
- `settings-models.png`
- `bunx playwright test tests/e2e/m3-settings.e2e.ts`：7/7
- `bunx playwright test tests/e2e/settings-center.e2e.ts`：1/1

