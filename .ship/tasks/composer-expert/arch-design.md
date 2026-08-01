# Composer 与专家能力绑定 · 轻量架构设计

## 决策

专家继续使用现有 `Profile`，增加可选 `skillIds` allowlist；Session 只保存 `profileId`，Run 启动时将 allowlist 与应用级已启用 Skill 取交集并冻结到既有 `CapabilitySnapshot`。子 Agent 继承父 Session 的 Profile、直接模型选择与权限模式。

## 九个设计镜头

1. **目标/非目标**：支持专家绑定模型、指令和 Skill；保持 Composer 轻量。此 Slice 不实现团队 DAG、并行 router、专家专属 MCP 或独立权限策略。
2. **数量级**：按单机少于 50 个 Profile、少于 200 个 Skill 估算；每次 Run 做一次 O(S + K) 内存过滤，200 次字符串比较远低于一次模型请求延迟。
3. **朴素方案优先**：复用 Profile、SkillCatalog 和 Run 快照，不新建 Expert 聚合或关系表。这是可逆的 two-way door；当单机 Skill 超过 2,000 个再评估索引表。
4. **契约**：`skillIds === undefined` 表示自动使用全部已启用 Skill；`[]` 表示明确不使用 Skill；非空数组表示 allowlist。未知或已禁用 id 在 Run 启动时忽略。
5. **失败模式**：Skill 被删除/禁用时该 Run 只少一个能力，不阻断启动；旧数据库列为 `NULL`，保持升级前行为；损坏 JSON 降级为空 allowlist，避免意外扩大权限。
6. **发布与回滚**：migration 018 只追加 nullable TEXT 列；旧行无需回填。回滚应用版本时旧列被忽略，不影响旧查询。
7. **安全边界**：Profile 只缩小 Skill 可见集合，不扩大工具权限；工具与 MCP 仍经过现有权限引擎。Profile 快照不保存系统提示词或密钥。
8. **取舍**：拒绝 Profile×Skill 关系表（本地规模不值得增加 repository）；拒绝在 Composer 放 Skill/MCP 开关（破坏轻量主路径）；拒绝复制 Skill 内容进 Profile（产生双 owner 和版本漂移）。
9. **重访触发**：需要不同子 Agent 使用不同技能、专家专属 MCP/工具权限、团队并行调度，或 Skill 数超过 2,000 时重新设计 Expert/Team 聚合。

## 假设

- 专家是可复用的能力预设，不是独立持久化 Agent 实例。
- 第一版 child 应继承父专家，直到产品引入显式 Team/角色编排。
- Skill 正文继续按需加载，Profile 只控制可发现范围。

## [Arch Design] Report Card

| Field | Value |
|---|---|
| Status | DONE |
| Summary | 复用 Profile + 可选 Skill allowlist，并在 Run 快照与 child 继承处收口 |

| Metric | Value |
|---|---|
| Lenses applied | 9/9 |
| Alternatives rejected | 3 |
| Assumptions recorded | 3 |
| Revisit triggers | 3 |
