# M2 探索式 QA 报告（Workspace 与安全）

范围：M2（S01–S11）在真实 Electron 应用中的探索式验证，运行于 E2E fixture 环境（fake OpenAI server + 独立数据目录）。E2E 已覆盖的确定性路径不重复验证；以下均为 E2E 未编码的边界。

## 验证项（6 项全过）

1. **挂起权限请求渲染重载恢复**：写工具等待授权时 `page.reload()`，卡片恢复可见并可响应（S06 重载逃生口）。证据：`qa-reload-pending.png`。
2. **stop 清理挂起请求**：等待授权时点停止，请求清除、无卡死，发送恢复可用（S06 逃生口）。证据：`qa-stop-cleared.png`。
3. **同路径工作区去重**：同一路径重复 create 只保留一个工作区（S01）。证据：`qa-dedupe-picker.png`。
4. **权限模式跨重启保留**：切换计划模式后硬重启，模式仍在（S09 模式是 Session 元数据）。证据：`qa-mode-persisted.png`。
5. **高危模态 Esc 即拒绝**：delete 模态按 Esc，模态关闭、工具被拒、文件未删（S08）。证据：`qa-modal.png`、`qa-modal-esc-denied.png`。
6. **「总是允许」规则删除后重新询问**：侧栏规则列表删除规则，下一次同路径写重新询问（S07）。证据：`qa-rule-list.png`、`qa-rule-removed-asks.png`。

## 发现并修复的问题（1 个真实 bug）

### 拒绝理由未透传给模型（P2，QA 发现）
- 现象：PermissionModal 收集的用户理由（PermissionResponse.reason）在 S06 broker 迁移中被丢弃，模型只收到通用「用户拒绝了授权」，无法按用户意见换一种方式。
- 证据：`PermissionModal.respond(false, reason)` → `createPermissionAskBroker.respond` 只消费 `allowed`；legacy permission-service 迁移前是透传 reason 的。
- 修复：`PermissionAskBroker.ask` 返回 `{ allowed, reason? }`，`respond` 透传 `response.reason`，PolicyEngine 拒绝时用该理由作为 block reason。
- 回归测试：`permission-ask-broker.test.ts`（理由透传）+ 全量单测 195/195 + E2E 13/13。

## 结论

Verdict: PASS（1 个 QA 发现的真实 bug 已修复并复验；其余探索项全部符合预期）。

未解决项：历史回放中「已拒绝」仍映射为 error（S06 已知限制，留 C12/U06）；glob 对工作区内指向外部的 symlink 可能枚举（C12 已知限制，读操作由权限层把关）。
