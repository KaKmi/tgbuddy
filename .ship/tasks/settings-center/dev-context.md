# Settings Center Dev Context

## 类型

UI / UX。无 Runtime、IPC contract 或存储结构变更，因此不执行 arch-design。

## 验收

- 设置从 420px 右侧抽屉改为 V3 原型的 900×650 居中 Dialog。
- 通用、模型、工具与权限、能力、外观五个入口均有真实内容。
- Provider、Profile、权限规则、Skill、MCP 复用现有 IPC，不创建第二套 owner。
- Skill 与 MCP 按应用级管理，设置页不再传递 workspaceId。
- 删除 Session 标题设置；标题生成保持固定产品行为。
- 管理、配置、撤销、连接、主题和偏好控件可交互。

## 验证命令

`bun test && bun run check:architecture && bun run typecheck && bun run build`

Electron 定向回归：

- `bunx playwright test tests/e2e/m3-settings.e2e.ts`
- `bunx playwright test tests/e2e/settings-center.e2e.ts`

## 设计依据

- `designs/tgbuddy-codex-light-v3/components.jsx`
- `designs/tgbuddy-codex-light-v3/styles.css`
- `tgbuddy-mockup/TgBuddy 交互原型.dc.html`

