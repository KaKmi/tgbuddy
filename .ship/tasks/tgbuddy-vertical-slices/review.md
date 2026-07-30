# M1 Code Review

评审范围：`d6465dc...c10cf3e`，覆盖 K01–K17，并以
`.ship/tasks/tgbuddy-vertical-slices/plan/spec.md` 和 `plan.md` 为验收基线。

## Findings

### P2：压缩后编辑保留消息会丢掉摘要并重新激活已压缩原文

- File: `src/runtime/sessions/session-message-history.ts:169`
- Trigger: 会话已有 compaction，用户对 `firstKeptEntryId` 或其后的用户消息执行“编辑并重发”。
- Observation: `truncate()` 在 pi 的物理 branch 中定位消息，并在
  `src/runtime/sessions/session-message-history.ts:194` 把 leaf 移到该消息的物理父节点。
  compaction entry 实际追加在保留消息之后，因此移动后摘要不在 active path，
  被摘要覆盖的旧消息反而重新进入 active history。
- Impact: Renderer 和下一次模型调用看到压缩前原文，违反 K13 的 active context
  和 K15 的“从当前有效历史截断”语义；长会话还可能立即再次超出上下文窗口。
- Fix: 截断必须以 `replayActiveMessages()` 的逻辑历史为准；遇到 compaction 时重建
  “摘要 + 截断点之前的保留消息”这条平铺 active prefix，同时保留旧 entry 和审计标记。

### P2：运行中删除 Session 会并发关闭 AgentHarness 正在使用的存储

- File: `src/runtime/app/tgbuddy-runtime.ts:160`
- Trigger: Session 有 active Run 时调用公开的 `session:delete` IPC。
- Observation: `truncate` 和 `clonePrefix` 都检查 `runs.isRunning()`，但 `delete`
  直接清理 Context、删除 catalog 和 pi Session。`PiSessionStore.delete()` 会关闭共享
  Session handle，而 AgentHarness 仍在该 handle 上追加消息。
- Impact: active Run 可能在落盘中途失败，catalog 已消失但运行事件仍继续收口，
  形成不可恢复的部分删除和误导性 UI 状态。
- Fix: 在 Runtime 边界拒绝 active Run 的删除；后续若产品需要“删除并停止”，应先
  stop 并等待 settled，再进入删除事务。

## Diagnosis

历史变更和 Session 删除都是跨 catalog、active branch、Run 生命周期的多步操作，
但约束没有全部收口在 Runtime/Session 状态边界，单层测试因而未覆盖组合状态。

## Fix Round 1

- 已修复压缩后截断：按逻辑 active history 重建摘要与保留前缀，旧 entry 和
  `tgbuddy.truncate` 审计记录继续保留。
- 已修复运行中删除：Runtime 在接触 Context、catalog 和消息存储前拒绝删除。
- 新增两个 RED 回归；完整测试 **114/114**、329 assertions，architecture、
  typecheck、build 与 packaged SQLite 12 场景通过。
- 状态：等待 fresh review。

## [Review] Report Card

| Field | Value |
|---|---|
| Status | FINDINGS |
| Summary | 2 个 P2，均为跨 Run/active-history 的状态完整性问题 |

### Metrics

| Metric | Value |
|---|---:|
| P1 | 0 |
| P2 | 2 |
| P3 | 0 |

### Artifacts

| File | Purpose |
|---|---|
| `.ship/tasks/tgbuddy-vertical-slices/review.md` | M1 静态评审 findings 与证据 |
