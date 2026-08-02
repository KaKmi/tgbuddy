# 权限与子 Agent UI/UX 开发 Ledger

Story 1: “可解释 Tool 非成功结果与目录读取修复” — complete
  Commits: 199f3ce
  Files: `src/shared/contracts/permission.ts`, `src/shared/contracts/events.ts`, `src/kernel/pi/pi-agent-engine.ts`, `src/renderer/atoms/agent.ts`, `src/renderer/components/ToolCard.tsx`, `src/renderer/App.tsx`, `tests/tool-activity.test.ts`, `tests/unit/kernel/pi-agent-engine.test.ts`
  Produces: `ToolNonSuccessReason`; `AgentEvent.tool_end.reason?`; `ToolActivity.reason?`; EISDIR → `invalid_invocation/directory_requires_list`; ToolCard 四类非成功说明
  Verification: RED 因缺少 reason/export 和 EISDIR 映射失败；targeted 14/14；`bun run probe`；architecture；typecheck；build
  Review: fresh peer review `PASS_WITH_CONCERNS`；无 P1/P2
  Concerns: 当前测试固定 projection 与四类文案，但未实际渲染 ToolCard 断言 repair hint；在 Task 25 ToolCard 专项组件测试中补齐。Task 1 为把 reason 接到真实 Renderer 消费者，按纵向闭环额外修改了计划清单未列出的 `src/renderer/App.tsx`，生产文件仍为 6 个，符合尺寸护栏。

Story 2: “InvocationNormalizer 与确定性 RiskClassifier” — complete
  Commits: 9ee5e62, 225df78, 277370b, 5b1ee0d, 5fda11e, 2fc25f4, 0336309
  Files: `src/shared/contracts/permission.ts`, `src/runtime/permissions/invocation-normalizer.ts`, `src/runtime/permissions/risk-classifier.ts`, `src/runtime/permissions/policy-engine.ts`, `src/renderer/components/PermissionBanner.tsx`, `tests/unit/runtime/invocation-normalizer.test.ts`, `tests/unit/runtime/risk-classifier.test.ts`, `tests/benchmark/permission-classifier.bench.ts`
  Produces: 五级 `RuleScope`；`ResolvedInvocation`；`CompleteRiskEvidence`；`InvocationNormalizer.normalize()`；`RiskClassifier.classify()`；Shell 执行环境绑定；MCP method/origin 身份绑定。
  Verification: targeted 27/27；benchmark p95=0.010ms；`bun run check:architecture`；`bun run typecheck`；`bun run build`。
  Review: 多轮安全 review 已修复 wrapper、quoted executable、command forwarding、environment assignment、MCP multi-origin 与 command substitution 绕过。按用户的速度优先决策，停止扩展 fuzz，以明文验收和现有门槛收口。
  Concerns: 非主流 Shell/MCP 边界统一转入最终集中 review/backlog，不阻塞主链路开发。
