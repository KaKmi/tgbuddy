# Composer 与专家能力绑定 · Dev Ledger

## Slice FR06 · Composer 原型还原

- 类型：UI / UX
- RED：`tests/composer-state.test.ts` 首次因 Composer state 模块不存在失败。
- GREEN：新增 `AgentComposer`，将模式、专家、模型、上下文、附件、输入、发送/停止收进 820px 原型容器；补齐 Enter、Shift+Enter、IME 组词保护与响应式布局。
- 兼容：更新旧 Electron E2E 的原型占位文案；保留 `model-chip` 等稳定测试定位符。
- 验收：Composer 截图、定向 Electron E2E、全量 unit、typecheck、architecture、build 通过。
- Commit：`fbceed4 feat(ui): restore composer and expert skills`

## Slice EX01 · 专家绑定 Skill

- 类型：契约 / Runtime / UI
- RED：Profile snapshot 缺少 `skillIds`、空 allowlist 被丢失、child 只继承权限三个断言失败。
- GREEN：Profile 增加可选 Skill allowlist；migration 018 持久化；Run 启动取已启用 Skill 交集；专家指令改为与工作区/计划/技能基础提示组合；child 继承 Profile、渠道、模型和权限。
- UI：专家编辑器提供“自动匹配 / 指定技能”，列表展示应用级状态与来源；Composer 专家菜单展示模型与技能摘要。
- 尺寸说明：该纵向契约跨 shared/runtime/infrastructure/main/renderer，超过 6 个生产文件不可再拆，否则会出现只保存不生效或只生效不持久化的半状态。
- 验收：专家绑定 E2E、packaged SQLite Spike、全量 unit、typecheck、architecture、build 通过。
- Commit：`8e25633 feat(profile): bind experts to skills`

## 视觉证据

- `qa/composer.png`
- `qa/expert-skills.png`
