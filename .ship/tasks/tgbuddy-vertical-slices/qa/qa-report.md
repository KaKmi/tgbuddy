# M3 探索式 QA 报告

## Verdict

PASS —— 13/13 探索项通过；发现 2 个真实缺陷已修复并复验。

## 方法

独立 Playwright/Electron 驱动（`qa-driver.mjs`，不依赖 E2E 用例），
覆盖 E2E 之外的边界路径；截图证据在 `qa/screenshots/`。

## 覆盖与结果（13/13）

| 探索项 | 结果 | 证据 |
|---|---|---|
| 渠道无密钥保存 → 显示「未配置密钥」 | PASS | 01-settings-model.png |
| 渠道编辑改名保留密钥状态 | PASS | 01-settings-model.png |
| 删除被 Session 引用的渠道被拒并显示原因 | PASS | 02-channel-delete-rejected.png |
| 模型 chip 选择写入会话 channelId/modelId | PASS | 03-model-chip-menu.png |
| 工具单工具覆盖为「禁止」 | PASS | 04-tools-section.png |
| 工具「恢复推荐」回退默认 | PASS | 04-tools-section.png |
| 工作区级技能随当前工作区出现 | PASS | 05-skills-section.png |
| 技能开关切换生效 | PASS | 05-skills-section.png |
| MCP 坏命令 → 可诊断失败（connection closed） | PASS | 06-mcp-error.png |
| MCP 连接后工具发现（echo.echo） | PASS | 07-mcp-connected-tools.png |
| MCP 断开后工具从列表移除 | PASS | 07-mcp-connected-tools.png |
| Run 结束后上下文面板显示最近运行账本 | PASS | 08-run-ledger.png |
| 优雅重启后渠道/设置持久化 | PASS | 09-restart-persist.png |

## QA 发现的真实缺陷（已修复 + 复验）

1. **删除渠道被拒的错误只在编辑表单内渲染**——表单关闭时用户看不到任何原因，删除像“没反应”。
   - 修复：设置面板顶部加全局错误横幅（`settings-error`），删除/Profile/MCP 等失败均可见。
2. **MCP 断开后设置页工具列表不刷新**——注册表已移除工具，但卡片仍显示旧列表。
   - 修复：disconnectMcp 后 refresh（与连接成功刷新对齐）。

## Issues beyond spec

- E2E 硬杀（child.kill）环境下 Electron safeStorage 的 DPAPI blob 无法被新实例解密：
  已做应用级韧性（单条失败只影响该 ref、迁移逐条容错、启动不阻塞），并在 E2E 报告记录。
- 截图目录同时保留 M1/M2 QA 的旧证据（共用 qa/screenshots）。

## 清理

QA 驱动使用临时数据目录并在 finally 删除；无残留进程（验证无 electron 残留）。
