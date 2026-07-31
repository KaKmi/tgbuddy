# TgBuddy 目标代码仓库设计复核报告

基线：`main@fc8a3d11a6f8257d9b6dfe700a9cf0e8d181b964`

## Peer 状态

Claude CLI 因组织策略不可用；两个隔离上下文的同模型 fallback 均未在限定时间内产出可审阅规格，已终止。`peer-spec.md` 如实记录失败，不包含伪造的 peer 结论。

因此本报告不是“host vs peer”的意见投票，而是主规格对当前仓库和批准文档的证据复核。

## 证据复核

| 规格结论 | 仓库证据 | 裁决 |
|---|---|---|
| 需要独立 Runtime 层 | `docs/01-架构设计.md:65-68` 要求 Runtime 不依赖 React，并通过稳定接口装配；当前没有 `src/runtime` | 采纳 |
| Main 职责过载 | `src/main/orchestrator.ts:55-249` 同时负责模型、工具、权限、存储、压缩和流；`src/main/ipc.ts:39-130` 直接定位全部 store/service | 拆成 Runtime façade + host adapter |
| pi 调用应收口 | `README.md:160`、`docs/01-架构设计.md:108`；当前 `orchestrator.ts` 和 `main/tools/**` 仍直接 import pi | 迁移到 `kernel/pi` |
| Sandbox 必须 run-scoped | `orchestrator.ts:100-101` 调用全局 `configureSandbox()`；`sandbox.ts:39-45` 持有全局 config | 使用 Mount snapshot + ExecutionEnvFactory |
| Workspace 不是目录 | `orchestrator.ts:321-324` 自动创建内部目录；文档明确要求逻辑 Workspace + 可重定位 Mount | Workspace/Mount 独立模块 |
| SQLite 可进入生产 | packaged evidence 九个场景通过，包含 crash、backup、legacy import | 生产接入，但不复用 spike launcher 作为 production code |
| JSONL 不再 canonical | `session-store.ts:31-32,343-419` 仍写 sessions.json/JSONL；文档已改为 SQLite canonical | 保留 importer/exporter，删除双写 |
| 权限需要 workspace owner | `permission.ts:39` 只有含义模糊的 ownerId；`permission-service.ts:283` 只有 session rule 写 owner | 拆分 scope owner |
| MCP 不能前缀放行 | `permission-service.ts:226` 在 plan mode 对 `mcp__` 全部放行，与功能范围冲突 | PolicyEngine 必须使用 descriptor 风险 |
| Renderer 需要按 feature 分割 | `App.tsx:43-313` 同时包含三栏、会话、对话、输入、结果区；`atoms/agent.ts` 集中所有状态 | feature state + global router |
| IPC 需要单一 contract map | `shared/ipc.ts:3-9` 明示新增通道要同步四处 | 保留友好 preload API，用 map + `satisfies` 校验 |
| child lineage contract 不完整 | `StreamPayload` 只有 agent 可选 `parentToolCallId`，host event 无 `agentRunId` lineage | frame 统一 lineage |

## 主规格内部取舍

### 1. 按层还是按功能组织 Runtime

选择 Runtime 内按功能垂直组织，外层再用 ports/adapters 分离。原因是权限、Workspace、Artifact 和 Delegation 都有自己的规则与 repository contract；若统一放成 `services/`、`repositories/`、`models/`，功能 owner 会再次分散。

### 2. 是否把所有类型放进 shared

否。只有跨进程或跨 adapter 的稳定 contract 放 shared。Repository、AgentEngine、BlobStore 等端口由消费它的 Runtime 模块拥有，避免 `shared` 变成无边界的公共垃圾场。

### 3. 是否引入通用 DI 容器

否。使用 `main/bootstrap/create-application.ts` 的显式构造和 `createTgBuddyRuntime(dependencies)`。这符合架构文档“小接口和显式工厂”的约束，也让测试替换 adapter 足够直接。

### 4. 是否彻底去掉 shared 中的 pi 类型

否。已定决策是消息不归一化，pi 类型允许出现在 shared；目标只收口运行时调用，并继续用 kernel version guard。事件仍由 kernel adapter 归一化。

### 5. SQLite backend 放哪

app repositories 放 `infrastructure/sqlite`；引用 pi SQLite backend 的 Session adapter 放 `kernel/pi`。二者可以使用同一数据库路径，但不建立跨表依赖。这同时满足 pi import 红线和 app/pi 表隔离。

### 6. Renderer 是否使用“通用 entities/widgets/pages”模板

不机械套模板。当前产品是一套桌面工作台，不需要路由型前端框架。只保留 `app / features / shared` 三层，状态和 UI 都由功能 owner 管理。

## 未解决风险

1. 缺少独立 peer 规格，设计的盲点风险高于正常 `/ship:design`。
2. AgentHarness 0.82.1 的具体构造和 SQLite Session adapter contract 仍需开发第一波前再次审计 installed package。
3. `scripts/sqlite-spike-*` 是验证代码，不应整包搬进 production；只复用已验证的不变量和 importer 纯逻辑。

## Debate Outcome

没有可用 peer，不能声称已完成真实 debate。进入开发前应补一次人工或异构模型 review；若当时仍不可用，至少由 `/ship:dev` 的 Story 1 reviewer 对目录边界和依赖 checker 做阻断式复核。

## Execution Drill

Fresh worker 只读取 Story 1 和当前配置/IPC 入口后给出 `FAIL`：

- 原计划只列出三个违规示例，没有完整目录依赖矩阵、扫描范围、type-only 例外、公开入口限制和退出码。
- Worker 无法从“合法依赖必须通过”推导一个可判定 checker。

本轮已按建议完成唯一一次修订：

1. 固定扫描 `src/**/*.{ts,tsx}`，排除 `.d.ts` 和构建产物。
2. 增加所有顶层目录的 allowed/forbidden 矩阵。
3. 明确 type-only import 默认也计入依赖，只保留消息/事件的 pi 类型例外。
4. 明确 `main/bootstrap` 是唯一 Composition Root，`main/ipc` 只能使用 `runtime/index.ts` 门面。
5. 明确 alias/index 解析、聚合诊断格式和退出码。
6. 把 Story 1 的 wildcard 文件改为精确路径，并补上 `vite.config.ts` alias 对齐。

按 Ship 规则不做第二轮无限打磨；Story 1 reviewer 仍需验证 checker 实现与矩阵一致。
