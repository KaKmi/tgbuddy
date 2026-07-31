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
# M2 E2E 报告（Workspace 与安全）

## Framework
- Playwright + Electron（`tests/e2e/`，既有框架，M1 已建立；本轮扩展 fake OpenAI server 支持 write/delete 工具流）。

## Tests added / modified
- `tests/e2e/m2-workspace.e2e.ts`（新增 2 条）
  - 工作区切换隔离会话：A 的会话在 B 不可见，切回 A 恢复。
  - 工作区目录丢失时新 run 被阻止并给出恢复动作（host_error 可见），目录恢复后可用。
- `tests/e2e/m2-permission.e2e.ts`（新增 3 条）
  - 写工具默认询问：允许后执行成功，拒绝后工具不执行（策略原因回给模型）。
  - 高危不可逆操作升级为模态确认，且不提供「总是允许」。
  - 「总是允许」规则跨重启生效：授权一次后不再询问。
- `tests/e2e/support/electron-fixture.ts`：新增 `TGBUDDY_WORKSPACE_DIR`（E2E 用 fixture 目录做 run cwd，避免读仓库根）。
- `tests/e2e/support/fake-openai-server.ts`：`streamToolCall` 泛化为任意工具名/参数；新增 `M2 写入`（write）、`M2 删除`（delete）场景。
- `tests/e2e/m1-runtime.e2e.ts`：停止按钮选择器改 exact（fixture 路径含测试名导致 strict 冲突）。

## Run results
- `bunx playwright test`：10/10 通过（M1 回归 5 条 + M2 新增 5 条），29.4s。
- 配套单测：194/194（新增 denied 不被 tool_end 覆盖、根目录文件 grant 候选两个回归测试）。

## Failures found & fixed（真实 bug，不是测试问题）
1. **denied 态被 tool_end 覆盖**：pi 对 policy 拦截调用补发 `tool_end(isError)`，把「已拒绝」覆盖成「失败」。修复：reducer 中 denied 为终态；单测覆盖（`tests/tool-activity.test.ts`）。
2. **根目录文件「总是允许」规则命中不了**：`suggestGrants` 目录提取在无分隔符时退化为文件名，`m2-write.txt/**` 匹配不到 `m2-write.txt`，规则建了也永远询问。修复：增加精确文件候选；单测覆盖（`permission-ask-broker.test.ts`）。
3. **M1 回归：run cwd 语义变更**（S02 起 cwd=工作区 mount.path），M1 fixture（README/LARGE.txt）不在 cwd。修复：`TGBUDDY_WORKSPACE_DIR` 让 E2E 默认工作区指向 fixture 目录（生产默认仍为启动目录）。

## Regressions
- 无（M1 全部 5 条 E2E 通过）。

## Artifacts
- 失败时 Playwright 自动截图/trace 在 `test-results/`（本轮最终全绿，无失败产物保留）。
