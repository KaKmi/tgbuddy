# M4（附件/产物/结果）与 M5（单层子 Agent）架构设计

> 按 ship:arch-design 的 lens 走查，结论记录于此；实施仍按 plan.md 的 Slice 拆分。
> 原则：**能用 pi 原生能力就用 pi**（图片内容、截断工具、消息模型、AgentHarness），
> 应用层只做 pi 没有的产品语义（Blob、Artifact、预算、lineage、结果区）。

## 1. Frame（目标/非目标/数字）

目标：
- 附件、长工具输出、非工作区产物写入 BlobStore，消息只存 ref，可恢复；
- 右侧结果区展示本次任务的产物，只读预览 + 外部打开 +「让 Agent 改这份」；
- root 可通过 `delegate_to_agent` 同步委派单层 child（最多 2 个、深度 1），预算/取消/权限/产物带 lineage。

非目标：云同步、并行 fan-out、DAG/router、独立 Team 页、产物内联编辑。

约束数字：
- 工具输出阈值 **256KB**：超过才落 Blob（docs/02 E2E #4）；
- 附件上限 **100MB**（参考 Proma `MAX_ATTACHMENT_SIZE`；超过拒绝并给出诊断）；
- child 上限 **2**、深度 **1**、失败也消耗名额（docs/02 2.4）；
- Blob 文件放 `userData/blobs/`，路径由内容 hash 派生。

## 2. 算术（back-of-envelope）

- 单条 tool result ≤256KB 直接进消息；>256KB 落 Blob，消息只存 preview（8 行）+ ref + size/hash。
- 附件按 100MB 上限、单会话附件通常 <20 个 → 单会话最大 ~2GB 原始文件，Blob 去重后实际远小。
- 结果区条目 = 成功产出次数，单任务通常 <50 条；按会话查询，量级无压力。
- child 预算：2 child × 平均 ~50K tokens ≈ 100K tokens 增量；按 RunRepository 的 usage 记账。

## 3. 先用最朴素的方案

- **Blob 不用 S3/云**：本地 FS + hash 文件名 + SQLite 存 ref 索引；两扇门（可随时换对象存储）。
- **附件复用 BlobStore**，不做 Proma 式 `attachments/{conversationId}/{uuid}` 目录（内容寻址天然去重、引用计数统一）。
- **长输出截断复用 pi**：`truncateHead/truncateTail/truncateLine` + `formatSize`，不重写截断逻辑。
- **附件进上下文复用 pi**：`harness.prompt(text, { images })` 原生支持图片 content，不做自定义 multimodal 适配。
- **Artifact 投影**：从 tool args + 成功结果推导（不读 pi `details`），沿用 C11 的 producing 判定思路。
- **child 复用同一套运行时**：child run 走现有 AgentEngine/RunCoordinator/Session，不建第二套。

## 4. 组件与契约

```text
shared contracts:  BlobRef / AttachmentRef / ToolOutputRef / ArtifactRef / ArtifactSummary
runtime ports:     BlobStore · ArtifactRepository · ArtifactContentService · DelegationPolicy
infrastructure:    NodeFsBlobStore（userData/blobs, hash 路径）· SqliteArtifactRepository · 清理服务
kernel/pi:         content adapter（A03 把 BlobRef 还原成 pi ImageContent/TextContent）
main/ipc:          attachment:* / artifact:* / result:* / delegate:*
renderer:          input attachments feature · results feature · 子 Agent 折叠组
```

关键契约：
- `BlobStore.put(bytes, meta?) -> { hash, size, mime }`；`get(ref) -> bytes`；`delete(ref)`；按 hash 去重；原子写（temp + rename）。
- `ArtifactRef`：sessionId + runId + name + kind(mime) + size + blobHash + producer（root/child + skill）。
- `ArtifactRepository.list(sessionId, {sinceRunId?}) -> ArtifactSummary[]`（时间倒序）。
- `DelegationPolicy.canDelegate(rootRunId) -> { ok, reason }`（child 数 ≤2、深度=1、token/成本预算）。
- `delegate_to_agent` tool：`{ task, model? }` → child Run（继承 workspace/snapshot/权限）→ settled 摘要作为 tool result。

## 5. 失败模式

- Blob 文件缺失/损坏：A09 启动扫描 + 诊断日志；会话恢复不阻塞，只有引用它的预览/回放报明确错误。
- 原子写失败：temp 清理，不留半文件（A01）。
- 附件路径逃逸：canonical path 校验，拒绝越界（A02，复用 S04 模式）。
- 断线/取消：child 与 root 共享 Abort 树（D03）；pending 权限在 child 结束时清理。
- 预算不足：delegate 返回明确原因，不静默失败（D01）。
- 引用计数：先事务更新 ref 再延迟物理删除，失败可重试（A09）。

## 6. 可运维与迁移

- 新表：`app_blob_refs`（引用计数索引，可选）、`app_artifacts`；Blob 物理文件不入 SQLite。
- 迁移路径：消息/ToolResult 契约向后兼容（新增 ref 字段可选）；旧消息无 ref 照常显示。
- 观测：结果区条数、Blob 总量、child run 记录（复用 `app_runs` lineage 列）。
- 回滚：端口 + 表新增，删除不影响既有功能。

## 7. 安全与信任边界

- Blob/附件读取走受控 adapter（canonical path + 只读），UI 不接触 Node path API；
- 外部打开只读、预览只读，改动一律回对话（「让 Agent 改这份」）；
- child 权限继承 root 的策略 snapshot，不自动扩大；`neverPersist` 规则对 child 同样生效；
- 附件 MIME 白名单 + provider capability 校验（不支持的格式拒绝进上下文）。

## 8. 取舍（被否决的备选）

| 决策 | 采用 | 否决 | 原因 |
|---|---|---|---|
| Blob 布局 | 内容寻址（hash） | 按会话 uuid 目录（Proma 式） | 去重、引用计数、恢复简单 |
| 模型上下文 | 截断 preview（pi truncate） | 完整输出进上下文 | token 预算；完整内容走 ref |
| 附件进模型 | pi 原生 images 参数 | 自建 multimodal 适配 | pi 已支持，少一层转换 |
| child 执行 | 同步单层 + 复用 AgentEngine | 并行 fan-out | docs/02 明确范围 |
| 结果区 | 时间倒序 + 类型筛选 | 按类型分组 | docs/06 决定 1 |

## 9. 触发重新审视的时机

- Blob 总量 >10GB → 上对象存储 / 外部目录；
- child 真实需求超过 2 个 / 深度 1 → 重做预算模型；
- 附件体积上限不够 → 调 `MAX_ATTACHMENT_SIZE` 并补流式落盘；
- 需要并行子任务 → 从同步单层升级到 fan-out（U 系列之后）。

## 10. 对 plan.md 的评估

M4（A01–A09）与 M5（D01–D04）与项目文档（docs/02 1.6/2.4、docs/06 决定 1/2）和调研
（Proma 附件/子代理、pi 原生能力）一致，无需重构。两处精化：

1. **A04 补一句**：模型侧只收截断 preview（复用 pi `truncate*`），完整内容经 `ToolOutputRef` 提供——
   修正 docs/06 决定 2 中「完整版仍然送给模型」的表述；
2. **A05 补 lineage**：Artifact producer 记录 root/child 与来源技能（docs/06 决定 1 要求「谁产生的」），
   child 产物归属在 D04 折叠组展示时使用。

## 11. A02 附件数据流（消息信封扩展）

附件是**应用元数据**，不属于 pi 消息本体（保持「零翻译」信封原则），因此：

- **选择 → stage**：Renderer `<input type=file>` 读字节 → IPC `attachment:stage {name,mime,bytes}`
  → Main 写 BlobStore → 返回 `AttachmentRef{id,name,size,mime,blob}`（Renderer 永不接触 Node 路径）；
- **取消 → discard**：未提交的草稿移除时 IPC `attachment:discard {ref}` 删 Blob（引用计数由 A09 兜底）；
- **发送 → 持久化**：`StartRunInput.attachments?: AttachmentRef[]` → RunInvocation → pi-engine 在
  用户消息 `message_end` 落库后，经注入的 `persistAttachments(sessionId, entryId, refs)` 端口写入
  `app_attachments` 表（key: session_id + entry_id）；**不改 pi 消息内容**；
- **回放**：`SessionMessageHistory.messages()` 按 entry_id join `app_attachments`，
  `KernelMessage.attachments?: AttachmentRef[]` 随信封给渲染层还原 chips；
- **A03 衔接**：模型上下文转换直接读 `KernelMessage.attachments`（图片走 pi 原生
  `prompt(text, {images})`），不再需要解析任何文本。

失败模式：stage 失败→chip 不出现且不占 blob；discard 失败→留给 A09 引用计数清理；
message_end 与附件写库不在同一事务→以 entry_id 为 key 幂等覆盖，A09 启动扫描补孤儿。
