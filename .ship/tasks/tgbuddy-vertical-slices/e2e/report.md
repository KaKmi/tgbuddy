# M1 Electron E2E 报告

## 结论

| 字段 | 结果 |
|---|---|
| 状态 | PASS |
| Framework | Playwright 1.62.0（本轮搭建，Electron `_electron.launch`） |
| 测试 | 5/5 通过 |
| 回归 | 0 |
| 真实缺陷 | 1 个，已修复并回归 |
| 最终耗时 | 21.0 秒 |

## 测试清单

`tests/e2e/m1-runtime.e2e.ts` 覆盖以下用户可见闭环：

1. 新建、流式回复、完成态重启回放、运行中硬重启恢复为 interrupted，并可继续发送；
2. 停止 Run、丢弃迟到文本，并允许下一次发送；
3. 工具调用成功态、输出展开和重启回放；
4. 85% 阈值自动压缩、压缩期间排队、压缩后自动发送和原文展开；
5. 编辑并重发截断旧后缀、从此新建扁平会话，以及新旧会话互不影响。

测试只替代第三方 OpenAI-compatible 模型端点；Renderer、Preload、IPC、Runtime、
pi `AgentHarness`、内置工具、SQLite 和重启恢复均运行真实实现。每条用例使用独立
Electron userData 与 TgBuddy 数据目录，串行执行，不访问真实渠道或 API Key。

## 发现与修复

停止用例首次运行发现：`TgBuddyRuntime` 把 `RunCoordinator.stop/isRunning`
实例方法裸转交给门面，IPC 调用时接收者改变，私有 `#registry` 无法访问，导致停止
按钮实际抛错并持续显示运行中。现已改为闭包委托，并补充保留 owner 接收者的单元回归。

## 最终验证

- `bunx playwright test`：5 passed；
- `bun test`：115 passed，0 failed，333 assertions；
- `bun run check:architecture`：通过；
- `bun run typecheck`：通过；
- `bunx tsc --noEmit -p tsconfig.e2e.json`：通过；
- `bun run build`：通过；
- 清理：测试启动的 Electron 与本地模型服务均已停止，无残留 Electron 进程。

## 证据

- `artifacts/playwright-report.html`：Playwright HTML 报告；
- 失败迭代的截图与 trace 位于本地忽略目录 `test-results/`，最终运行无失败制品。
