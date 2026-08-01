# M4–M6 探索式 QA 报告

时间：2026/8/1 08:31:59
结果：11/11 通过

## 场景
- ✅ U01：整窗空状态显示三个任务样例
- ✅ U01：点击样例新建会话并预填草稿（不自动发送）
- ✅ 冒烟：普通消息流式回复
- ✅ M4：附件选择 → chip → 发送后消息回显附件
- ✅ M4：write 产物进结果区，可预览并「让 Agent 改这份」
- ✅ U02：会话搜索过滤
- ✅ U03：会话菜单置顶与归档
- ✅ 计划模式闭环：提交计划 → 审批 → 执行
- ✅ 完全访问：写操作直接放行不询问
- ✅ 设置页：技能分组可见、工具区已移除
- ✅ 布局证据：主窗口 + 结果区截图（视觉比对素材）

## 截图证据（screenshots/）
- 01-empty-state.png
- 02-attachment-message.png
- 03-results-preview.png
- 04-plan-approval.png
- 05-settings.png
- 06-main-window.png
- 07-results-panel.png

## 原型视觉比对清单（供人工比对）
- 主窗口 → 原型 data-screen-label="main"
- 结果区 → 原型 main 结果区（时间倒序 + 分组 + 类型筛选）
- 设置页 → 原型「设置 技能与工具」场景
- 计划审批卡 → 原型「权限确认」与 Codex 式 TL;DR 摘要