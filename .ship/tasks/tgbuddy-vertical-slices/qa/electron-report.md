# M1 Electron QA 报告

- 日期：2026-07-31
- 范围：M1 可恢复 Agent 内核（K01–K17）
- 应用入口：`file:///C:/Users/Administrator/Desktop/prom/proma-mini/dist/renderer/index.html`
- 会话：`tgbuddy-qa`
- 运行方式：打包后的 Renderer + Electron Main/Preload + 真实 IPC/Runtime/SQLite
- 结果：发现 1 个 P2，其余探索项通过

## 严重度汇总

| 严重度 | 数量 |
| --- | ---: |
| P0 | 0 |
| P1 | 0 |
| P2 | 1 |
| P3 | 0 |

## 通过项

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 首次启动空状态 | 通过；三栏结构、空状态、输入禁用状态正常 | [01-empty-state.png](screenshots/01-empty-state.png) |
| 新建会话 | 通过；会话进入选中态，输入框可用 | [02-new-session.png](screenshots/02-new-session.png) |
| 权限模式菜单 | 通过；菜单层级、选中态、文案正常 | [03-mode-menu.png](screenshots/03-mode-menu.png) |
| 运行中状态 | 通过；侧边栏显示“正在思考…”，发送按钮切换为“停止” | [04-running.png](screenshots/04-running.png) |
| 停止运行 | 功能通过；停止后按钮恢复，等待 2.5 秒没有迟到增量 | [05-stopped.png](screenshots/05-stopped.png) |
| 正常完成 | 通过；消息、状态、上下文用量入口正常，无 Console/Page Error | [06-completed.png](screenshots/06-completed.png) |
| 工具调用 | 通过；`read` 调用卡片可展开，参数和工作区输出正确 | [07-tool-expanded.png](screenshots/07-tool-expanded.png) |
| 编辑并重发 | 通过；原消息可编辑，旧分支被替换，新结果与编辑后输入一致 | [07-tool-expanded.png](screenshots/07-tool-expanded.png) |
| 从此新建会话 | 通过；创建独立会话并保留分叉点消息 | [08-cloned-session.png](screenshots/08-cloned-session.png) |
| 键盘输入 | 通过；`Enter` 发送，`Shift+Enter` 保留换行 | 浏览器可访问性快照与输入值检查 |
| 重载恢复 | 通过；重载后会话列表、消息、工具调用和完成状态仍可读取 | [09-reloaded-session.png](screenshots/09-reloaded-session.png) |
| 上下文用量与手动压缩 | 通过；面板可开关，短上下文压缩给出明确反馈 | [10-context-usage.png](screenshots/10-context-usage.png) |

## 问题

### QA-M1-001 · 中止后的会话被标记为“未开始”

- 严重度：P2
- 类型：状态投影 / 用户反馈
- 复现率：2/2
- 前置条件：新建会话并发送一条会触发运行的消息

复现步骤：

1. 等待侧边栏进入“正在思考…”，发送按钮变为“停止”。
2. 点击“停止”。
3. 等待按钮恢复，并确认消息流中已存在用户消息和部分 Agent 输出。
4. 查看左侧会话状态。

实际结果：

- 会话状态显示“未开始”，但该会话已经执行过并留下消息与工具调用。

预期结果：

- 显示“未完成”或等价的中止状态，避免与从未运行过的空会话混淆。

影响：

- 用户从侧边栏无法区分“从未运行”和“运行后中止”，恢复任务时容易选错会话。

证据：

- 运行中：[04-running.png](screenshots/04-running.png)
- 停止后：[05-stopped.png](screenshots/05-stopped.png)
- Electron CDP 连接不支持 `Target.createBrowserContext`，因此 `agent-browser record` 无法为现有窗口创建视频上下文；保留前后截图作为证据。

## 运行观察

- 连续切换、新建、分叉和重载过程中未出现白屏、崩溃或不可恢复输入状态。
- 工具卡片沿用原型的低噪声成功态；失败工具使用红色错误反馈，结构与状态区分清晰。
- 页面 Console 和 Page Error 检查为空。
- QA 完成后已关闭 `tgbuddy-qa` 会话、Electron、CDP 与本地模型服务；端口 `9222`、`50071` 及对应进程均无残留。
