# Host / Peer 规格对照报告

## 结论

两份独立规格对产品定位、事实来源、迁移方式和主要能力顺序没有根本分歧。最终计划采用 host 的更细拆分：已完成基座之后共 62 个待开发 Slice；peer 的 22 个切片作为覆盖校验，不直接作为开发单位。

## 一致项

| 主题 | Host | Peer | 处理 |
|---|---|---|---|
| 产品定位 | 用户自有设计的通用桌面智能体 | 同意，不是外部产品复刻 | 固化到 spec/AGENTS |
| UI 事实源 | 本地交互原型 | 同意 | 每个用户可见 Slice 标原型锚点 |
| 基座 | Phase 0、Story 1A 不重做 | 同意 | 从 K01 开始 |
| 研发方式 | 内核优先、小纵向切片 | 同意 | 每次 `$ship:dev` 默认 1 Slice |
| 迁移方式 | compatibility 逐项替换 | 同意 | 每个 Slice 写删除项 |
| 核心能力 | Tool、Skill、MCP 是第一版核心 | 同意 | 提前为 M3，不拖到 UI 收口后 |
| 最终验收 | 7 个原型场景 + 7 条 E2E | 同意 | U01–U09 收口 |

## 差异与裁决

### 1. 22 个切片还是 62 个切片

- Peer 把“SQLite + catalog + UI”“MCP discover + call”“delegation 全链”等压成 22 个切片。
- Host 进一步拆开数据库启动、repository、UI cutover、discover、call、snapshot、lineage、child 执行、取消和 UI。
- **裁决**：采用 62 个。用户明确要求不要大而全，要快速开发、快速验证。每个 Slice 的主要行为更单一，也更适合独立 commit/review。

### 2. Workspace 放在会话 catalog 后还是完整内核后

- Peer 建议 SQLite catalog 后立即做 Workspace picker。
- Host 把 Workspace 放在可恢复 Run、tool、compaction 后。
- **裁决**：保留 host 顺序。用户明确“先实现内核”；当前 App 已有单 Workspace 兼容路径，可先验证 durable conversation loop。Workspace 仍是 M2 第一项，不会拖到产品最后。

### 3. 纯基础设施 Slice 能否单独完成

- Peer 倾向每个 Slice 都含最短 Runtime→IPC→Renderer 路径。
- Host 允许 K01/K04/A01/C01 这类基础设施以真实 adapter test 独立完成，但要求下一个 Slice 立即消费。
- **裁决**：采用 host 规则。强行给 schema/Blob/Secret 塞 mock UI 会制造假闭环；真实 adapter + reopen/crash/atomic 测试已经是独立可验证行为。连续两个纯基础设施 Slice 仍被禁止。

### 4. 能力系统的先后

- Peer 把 Blob/Artifact 放在 Channel/Skill/MCP 前后交错。
- Host 先做完整 Tool/Skill/MCP，再做 Blob/Artifact。
- **裁决**：保持 M3 能力优先，符合用户强调的通用智能体、MCP、Skill；MCP 长输出在 A04 补 Blob 化，C11 先完成普通调用与错误闭环。

## 从 Peer 吸收的修正

1. K04 明确把 pi SQLite backend 从 devDependency 提升为生产 dependency。
2. K11 删除了对未来 S05 的错误依赖，改用显式 PolicyEngine fake。
3. MCP discovery 与 invocation 拆成 C10/C11，CapabilitySnapshot 顺延 C12。
4. Artifact 预览与“让 Agent 改”拆成 A07/A08。
5. 会话分组/搜索与菜单动作拆成 U02/U03。
6. 七场景视觉任务拆成 U05/U06/U07，不保留一个“大而全视觉 Story”。
7. compatibility/feature owner 收口与 E2E 拆成 U08/U09。
8. U09 写入 `docs/02-功能范围.md:154-160` 的 7 条精确用例。
9. U08 明确删除单一 IPC、`shared/types` re-export、总 atom/总 listener。

## 覆盖检查

- 线性、可恢复会话：K01–K06、K12、K15–K16。
- Agent run / stop / tool / compaction：K07–K14。
- Workspace / sandbox / permission / plan / ask_user：S01–S11。
- Channel / Profile / Tool / Skill / MCP：C01–C12。
- Blob / attachment / long output / Artifact：A01–A09。
- 单层 child：D01–D04。
- 原型 7 场景：U01–U07。
- legacy 与边界清理：K17、S11、C12、U08。
- 7 条产品 E2E：U09。

没有发现必须由用户先做新选择才能继续的阻塞项。下一开发 Slice 固定为 K01。

## Fresh execution drill 修正

Fresh Agent 试钻 K01–K04 后发现 3 个执行歧义，已做唯一一轮修订：

1. K01 明确 app 与 pi 共用物理文件 `userData/tgbuddy.db`，但使用独立连接/迁移；TgBuddy 只管理 `app_schema_migrations` 与 `app_*`，不得依赖 pi 私表。
2. K01 不再把现有 pi fixture spike 当成 AppDatabase 证据；packaged spike 必须新增直接 import 生产 `AppDatabase` 的 `app-database` 场景，验证 reopen 和 close 后无锁。
3. `app_sessions` schema 移到 K02 的 `002_app_sessions.sql`；K03 明确修改 `create-legacy-runtime.ts`，由 `createApplication()` 注入 repository，并把 AppDatabase 关闭纳入应用 dispose。

修订后 K01 的范围是“迁移协议 + packaged 证明”，K02 是“Session catalog”，K03 是“生产装配/现有 UI cutover”，三者不再互相隐藏验收前提。
