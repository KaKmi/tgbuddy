# 权限与子 Agent UI/UX 开发上下文

## 执行基线

- 测试命令：`bun test`
- 架构门禁：`bun run check:architecture`
- 类型门禁：`bun run typecheck`
- UI/入口改动：追加 `bun run build`
- pi 适配改动：追加 `bun run probe`
- 代码规范：遵循仓库根目录 `AGENTS.md`；注释、测试、诊断与文档使用中文；禁止 `any`；每个 Story 独立 RED、GREEN、评审与提交。
- 工作树：保留任务外既有改动，只暂存当前 Story 的明确文件。

## Wave 依赖图

31 个 Story 按 `plan/plan.md` 的 Task 1 → Task 31 串行执行。原因是后续 Story 消费前序产出的权限契约、interaction projection、ticket gate、子任务状态机和 UI projection；多个相邻 Story 还会修改相同契约或入口文件，不满足并行写入条件。

每个 Wave 的固定出口：目标测试通过 → 风险对应 gate 通过 → 单独 commit → fresh peer review PASS/PASS_WITH_CONCERNS → ledger 记录 → 下一 Wave。

## Story 1 模式证据

- `src/shared/contracts/events.ts`：现有 `AgentEvent.tool_end` 是 kernel 到 renderer 的结构化结果边界，适合增加可选的非成功原因，不改变成功事件。
- `src/kernel/pi/pi-agent-engine.ts`：`piEventToAgentEvent()` 在 `tool_execution_end` 分支集中提取 output/details，是 EISDIR 明确兼容映射的唯一 pi adapter owner。
- `src/renderer/atoms/agent.ts`：`applyAgentEvent()` 是 Tool activity projection 状态机；既有 `tool_denied` 保护晚到 `tool_end` 不覆盖拒绝状态。
- `src/renderer/components/ToolCard.tsx`：既有状态视觉和错误默认展开，新增 reason 只负责解释展示，不反推或改变权限决策。
- `tests/tool-activity.test.ts`、`tests/unit/kernel/pi-agent-engine.test.ts`：分别覆盖 renderer projection 与 pi event adapter。

后续 Story 开始编码前，继续在本文件追加该 Story 的 1–3 个完整模式引用和消费/产出边界。

## Story 2 模式证据

- `src/runtime/runs/agent-engine.ts`：`ToolPolicyInput` 是现有 kernel → Runtime 权限边界；Normalizer 直接消费该 DTO，不把 pi 类型或 Renderer 状态带入 Runtime。
- `src/runtime/permissions/policy-engine.ts`：现有只读 Shell、系统禁区、MCP 和文件启发式都集中在 Policy；本 Story 先抽出纯 normalization/classification owner，Task 4 再删除旧决策分支的双 owner。
- `src/kernel/pi/pi-builtin-tools.ts`：内置文件工具的真实参数形状为 `path`、`paths[]`、`pattern + dir`，delete 进入回收站且批量阈值为 50；分类器据此区分 R1、R2 与批量 R4。
- `docs/design/009-permission-human-interaction.md` 与 `docs/design/011-permission-subagent-architecture.md`：风险矩阵固定为 R0 控制、R1 只读、R2 工作区内可逆、R3 越界/联网/外部副作用、R4 不可逆/敏感、F 禁止；完整未知为 R4，分类器异常不是 unknown。

边界：本 Story 产出纯函数与完整 evidence，不接入真实 Policy 执行；`RuleScope` 扩为五级时，legacy UI 仍只暴露 session/project/global，短期 Policy 对 agent_run/delegation 旧规则 fail closed，Task 4/6 接管真实 subject 与 matcher。
