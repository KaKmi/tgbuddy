# Host / Peer 前端还原规格对照报告

## 结论

两份独立规格对核心判断一致：这不是从零重建前端，而是在保留真实 Runtime/IPC 闭环的前提下，按 Codex Light v2 收口双主题、三栏 AppShell、完整能力入口、结果区、设置中心、响应式和键盘交互；两份规格都明确拒绝恢复过时的 per-tool 三档权限编辑。

## 差异与裁决

### 1. Session 菜单与草稿保护

- Peer 指出当前 `SessionMenu` 仍使用原生 `window.prompt/confirm`，且快捷新建/切换不能静默丢弃输入与附件（`peer-spec.md:99-112,141-145`）。
- Host 原规格只要求保留菜单动作与新增快捷键，没有写清产品内 Dialog 和脏草稿保护。
- **裁决：patched。** 已在 `spec.md` 的侧栏与验收标准补充统一 popover/Dialog、Escape/focus return，以及正文/附件草稿确认。

### 2. Artifact 来源与不存在的动作

- Peer 要求存在真实 contract 才显示来源或 Tool replay，禁止根据文件名猜 child/root，也禁止放假重试（`peer-spec.md:79-85,153-159,229-235`）。
- Host 原规格只说结果区使用真实数据，约束不够具体。
- `ArtifactRef` 确实提供 `size`、`sourceSkill`、`producerRunId`（`src/shared/contracts/artifact.ts:14-27`），但 `producerRunId` 本身不能直接解释为 root/child。
- **裁决：patched。** 规格现在只允许展示可直接解释的真实 size/sourceSkill，并明确无导出/replay contract 就不显示动作。

### 3. U08 文档与代码漂移

- Peer 指出进度文档声称 U08 完成，但 `App.tsx`、总 atom、总 listener、Main IPC 与 `shared/types` compatibility 仍存在（`peer-spec.md:229-236`）。
- Host 计划拆 Renderer，但未写明不顺手扩大到 Main/IPC。
- **裁决：patched。** 风险中明确：本任务随触达范围拆 Renderer owner，Main/IPC 大迁移另立任务，不能在主题 Slice 大爆炸重构。

### 4. Slice 粒度

- Peer 建议 17 个单行为 Slice，把 Shell/响应式、Sidebar/Session、Composer/能力入口、Tool/权限/压缩、Results、设置各页和最终 gate 分开（`peer-spec.md:167-191`）。
- Host 原规格只有“每 Slice 单一行为”的原则，未固定数量。
- **裁决：conceded。** 实现计划采用 17 个 Slice；这更符合用户要求的细拆、独立测试和独立 commit，也避免设置中心再次成为大 Story。

### 5. 视觉基准宽度

- Peer 完成定义使用 1440×900（`peer-spec.md:239-250`）。
- 设计资产元数据明确记录 1500×900（`designs/tgbuddy-codex-light-v2/_d_meta.json:13-16`），CSS 也以 1500px 为最大 app-window（`designs/tgbuddy-codex-light-v2/styles.css:117-120`）。
- **裁决：proven-false。** 主视觉基准固定为 1500×900；另测 1180/820/640 断点。1440 可作为一般桌面 smoke，不作为精确对照基准。

### 6. 设置页权限模型

- 两份规格一致认为 Light v2 的 per-tool `<select>` 已过时；当前 E2E 要求 `tool-row` 为 0（`tests/e2e/m3-settings.e2e.ts:79-96`）。
- **裁决：一致，无需修改。** 设置只复用视觉层级，工具默认只读，长期授权仅展示/撤销真实规则。

## 未升级项

没有需要用户先裁决的 `escalated` 项。所有差异均由当前代码、contract、测试或设计资产元数据裁决。

