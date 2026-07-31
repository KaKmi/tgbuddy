# Dev Context

## Test Command

- 故事级回归：`bun test`
- 类型门：`bun run typecheck`
- 构建门：`bun run build`
- Packaged Electron 集成门：`bun run spike:sqlite`

## Code Conduct

- 注释、测试名称、诊断和文档一律中文，保留必要英文术语。
- 永远不用 `any`；对象类型优先 `interface`；仅类型导入使用 `import type`。
- pi 运行时调用只留在 `scripts/**` 的 Spike 边界，不修改生产 SessionStore、IPC、preload 或 renderer。
- 测试使用 Bun `bun:test`，断言具体行为和失败诊断。
- 使用 ESM、`.ts` 扩展名和 Node 内置模块的 `node:` 前缀。
- 提交使用 Conventional Commits，只暂存当前故事列出的文件。

## Pattern References

### Story 1: 固定依赖并完成 legacy 纯解析与映射

- Reference: `src/shared/types/session.ts`
  - Why analogous: legacy JSONL 的 header 和 entry 联合类型事实来源。
  - Mirror: 判别联合、中文契约注释和版本护栏。
  - Deviations: importer 是隔离 Spike，不接生产读写路径。
- Reference: `src/shared/types/message.ts`
  - Why analogous: message 信封和 `toKernelMessages()` 的现有映射语义。
  - Mirror: kernel/notice/compaction 的穷尽分发。
  - Deviations: model_change/truncate 以 custom entry 保存兼容信息。
- Reference: `src/main/session-store.ts`
  - Why analogous: 现有逐行 JSONL 读取和最早 truncate 统一裁剪语义。
  - Mirror: 坏行隔离、最后 compaction 和最早截断点重放规则。
  - Deviations: Spike 增加严格 schema 诊断和稳定 fingerprint。
- Reference: `tests/compaction.test.ts`
  - Why analogous: Bun 测试结构、中文测试名和 pi entry 构造方式。
  - Mirror: `describe/test/expect`、精确数组断言。
  - Deviations: fixture 从磁盘读取，覆盖导入诊断。

### Story 2: 生成真正 packaged 的无窗口 Electron runtime

- Reference: `src/main/index.ts`
  - Why analogous: Electron ESM 主进程生命周期和 `app.whenReady()` 用法。
  - Mirror: 顶层模块导入、显式错误输出、生命周期收口。
  - Deviations: Spike 不创建窗口，并在 ready 前重定向应用路径。
- Reference: `scripts/probe.ts`
  - Why analogous: 隔离于生产入口的可执行验证脚本。
  - Mirror: 明确前置检查、失败退出码和中文运行诊断。
  - Deviations: launcher 只编排，所有业务断言在 packaged Electron 内。
- Search note: 仓库没有现成 Packager/ASAR fixture；实现以
  `@electron/packager@20.0.4` 类型声明和官方选项契约为参考。

### Story 3: 验证顺序、隔离、compaction、cleanup 和 WAL backup

- Reference: `node_modules/@earendil-works/pi-agent-core/dist/harness/session/session.d.ts`
  - Why analogous: `Session` 的 append/reopen/buildContext 公开契约。
  - Mirror: 只通过公开 Session API 写业务数据。
  - Deviations: checkpoint/integrity 审计允许使用只读 SQL/PRAGMA。
- Reference: `node_modules/@earendil-works/pi-agent-core/dist/harness/types.d.ts`
  - Why analogous: `SessionTreeEntry`、metadata、storage/repo 的完整类型。
  - Mirror: entry 身份、parent/leaf 和 stats 契约。
  - Deviations: SQLite storage 的 `cleanup()` 由运行时类型守卫访问。
- Reference: `tests/compaction.test.ts`
  - Why analogous: compaction 边界与 `buildContext` 预期。
  - Mirror: 真实 entry ID、摘要和保留消息的精确断言。
  - Deviations: 本故事还验证 reopen、WAL 和文件锁。

### Story 4: 验证 packaged child 强杀恢复

- Reference: `src/main/safe-file.ts`
  - Why analogous: 临时文件加 rename 的原子发布模式。
  - Mirror: marker 先写 `.tmp` 再 rename。
  - Deviations: marker 只用于观测已提交序号，不承担业务持久化。
- Search note: 仓库没有现成 child-process 强杀测试；实现使用
  `node:child_process` 的事件契约，并按平台选择 `taskkill`/`SIGKILL`。

### Story 5: 验证 SQLite legacy 幂等导入

- Reference: `src/main/session-store.ts`
  - Why analogous: legacy entry 的当前重放、compaction 和 truncate 行为。
  - Mirror: 最后 compaction 与最早截断点决定 active context。
  - Deviations: 导入通过 deterministic Session ID、marker、fingerprint 和 digest 保证幂等。
- Reference: `src/main/safe-file.ts`
  - Why analogous: 冲突时保留现有数据和显式恢复边界。
  - Mirror: 不覆盖不属于当前恢复协议的数据。
  - Deviations: SQLite 半成品通过 repo metadata 和事务化 delete/recreate 处理。

### Story 6: 汇总完整报告、证据和回归质量门

- Reference: `scripts/probe.ts`
  - Why analogous: 运行时验证的可读诊断和非零失败退出。
  - Mirror: 每个门都有明确结果，失败不静默。
  - Deviations: evidence 只保存稳定版本、数字和场景状态，不保存绝对路径。

## Waves

计划声明的文件范围形成严格依赖链：

1. Wave 1：Story 1
2. Wave 2：Story 2（消费 Story 1 测试和 importer）
3. Wave 3：Story 3（修改 Story 2 runtime/scenario）
4. Wave 4：Story 4（消费 Story 3 连续前缀断言）
5. Wave 5：Story 5（消费 Story 1 importer 和 Story 2 launcher）
6. Wave 6：Story 6（汇总 Stories 2–5）

所有波次均为单故事顺序执行；不存在安全的并行故事。
