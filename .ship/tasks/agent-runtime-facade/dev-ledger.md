# Agent Runtime 门面开发 Ledger

## R01 · AgentRuntime 正式门面

- 状态：完成，独立评审 PASS。
- 提交：`10a5c5f refactor(runtime): establish AgentRuntime facade`
- RED：门面单测因 `createAgentRuntime`、`AgentRuntimeDependencies` 和 `AgentRuntimeEvent` 尚未导出而失败。
- GREEN：门面与架构定向测试 12/12，通过 architecture、typecheck 和 build。
- 产出：`AgentRuntime`、`AgentRuntimeDependencies`、`createAgentRuntime()`、`AgentRuntimeEvent*`、`TgBuddyApplication.agentRuntime`。
- 评审：初审发现 `dev-context.md` 提前进入 R01 的 P3 scope finding；移出提交后复核无 finding。

## R02 · Run start 语义链

- 状态：完成，独立评审 PASS，0 finding。
- 提交：`refactor(runtime): clarify run start semantics`（本 Slice）
- RED：测试先迁移到 `start()` 后，13 个用例因 Runtime/Coordinator 尚无 `start()` 而失败。
- GREEN：定向测试 25/25，通过 89 个 assertions。
- 产出：`StartRunInput`、`AgentRuntime.runs.start()`、`RunCoordinator.start()`；外部 `agent.send()` 与 `agent:send` 保持不变。
- 全量门禁：`bun test` 115/115（333 assertions），architecture、typecheck、build 通过；build 仅保留既有 chunk 体积 warning。
