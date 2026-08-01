# Frontend Restoration Execution Drill — 第二轮

> **2026-08-01 V3 变更提示：** 本报告的 CLEAR 结论针对 Codex Light v2 计划。用户随后新增 LLM Session Title、应用级 Skill/MCP、工作区文件树和文件查看器，并删除“让 Agent 改这份”；`plan.md` 已同步为 V3，进入开发前应对 FR05A、FR07、FR11–FR17 做一次新的 execution drill。

> WARNING: Drill was fallback-Agent-performed, not peer-agent。

## 结论

**CLEAR**。本轮按要求只重新检查 FR05、FR12–FR17 与 `Spec Coverage` 的验收 14 映射。第一轮 UNCLEAR 项均已用可执行的路径、接口、状态 owner、失败语义、删除边界或证据要求补齐；未发现 BLOCKED 或残留 UNCLEAR。

## 逐 Slice 结果

| Slice | 结果 | 第二轮核对 |
|---|---|---|
| FR05 | CLEAR | 所有文件均为完整仓库相对路径；`NavigationIntent` 三种 union、草稿判定、`stay` 无副作用、`discard` 清草稿后单次执行均明确；unit/E2E 覆盖和 gate 可直接执行。 |
| FR12 | CLEAR | `SettingsDialogProps`、`SettingsTab`、`DirtyCloseDecision`、activeTab/focus/dirty-close owner 明确；遮罩/Escape/关闭按钮共用协议；本 Slice 仅开放真实 Models/Appearance，后续 tab 不建空页；旧面板以 `embedded`/`onDirtyChange` 临时保留 owner，迁移边界清楚。 |
| FR13 | CLEAR | 创建/修改路径完整；`SettingsSnapshot`、`SettingsDataState`、`useSettingsData(workspaceId)` 的唯一 owner、refresh/loading/error 语义明确；Channel/Profile 的 CRUD、连通性、secret、脏表单、失败保留及旧 owner 删除均有 RED/GREEN。 |
| FR14 | CLEAR | 页面 props、真实 Tool 字段映射、规则撤销成功/失败语义明确；文档路径已列入 Modify；Permissions 导航接入与旧 permission/tool owner 删除明确。 |
| FR15 | CLEAR | workspace 变化 reload、toggle 成功 refresh、失败不改 snapshot、loading/error/retry owner 均明确；Skill state/handler/markup 的迁入与旧 owner 删除明确。 |
| FR16 | CLEAR | MCP 页面与 discovery 组件职责分开；CRUD/连接动作 pending、成功统一 refresh、失败保留表单与 snapshot 的语义明确；最终删除 `ChannelSettingsPanel.tsx` 和 import，不再保留第二 owner。 |
| FR17 | CLEAR | 八张截图的固定目录和文件名明确；首个 RED 有确定失败原因；七场景各有语义断言和键盘路径；1180 overlay 有补充断言；checklist 必须逐条关联验收 1–14 后才能完成；最终全套 gate 完整。 |

## 验收 14 映射

**CLEAR**。`Spec Coverage` 已改为：验收 14 → FR04–FR05、FR07、FR12，准确覆盖：

- FR04–FR05：新建/切换会话或工作区的草稿确认，以及 SessionMenu、重命名、删除；
- FR07：能力 popover 的 Escape、外部点击与焦点返回；
- FR12：Settings Dialog 的 Escape、遮罩/关闭协议、focus trap/return 与脏表单确认。

FR17 另明确最终复核验收 1–14，同时不替代各 Slice 独立 RED/GREEN，覆盖关系无遗漏或重复 owner。

## Drill Gate

- CLEAR：7/7 个复核 Slice。
- UNCLEAR：0。
- BLOCKED：0。
- 未发现 `TBD`、`TODO`、“类似前项”或未定二选一删除项。
- 计划可交给 `/ship:dev` 按 FR01–FR17 顺序实施。
