# M3 集中 Review（C01–C12）

## Scope

- Base: `f5b3b3b`（M2 收口）→ HEAD：98 个文件，+7749/-238 行。
- Spec: `.ship/tasks/tgbuddy-vertical-slices/plan/spec.md` + `plan.md` 的 C01–C12 章节。
- 方法：按子系统分批全文件阅读（密钥/渠道、Profile、工具注册与权限、技能、MCP、Run 快照与 legacy 收口），追踪跨文件调用链，对照 AGENTS 架构红线与原型约束。

## Findings（全部已修复并 fresh 复核）

### P1：`runs:list` IPC 恒返回空，UI 账本不可见
- File: `src/runtime/runs/run-coordinator.ts`（缺 `list()`）、`src/runtime/app/agent-runtime.ts:184`
- Trigger: `AgentRuntime.runs.list()` 走 `dependencies.runs.list?.() ?? []`，而 RunCoordinator 接口没有 `list()`，生产恒取空数组。
- Impact: C12 的「每个 Run 持久化快照与账本」在 UI 上不可见，能力快照成为只写不读的死数据。
- Fix: RunCoordinator 增加 `list(sessionId)` 转发 `RunRepository.listBySession`；集成测试断言 `coordinator.list()` 返回 run-1。

### P2：plan 模式把 `pg.query` 当写类拒绝
- File: `src/runtime/mcp/mcp-manager.ts` `isReadLikeMcpMethod`
- Trigger: 判定用 `toolName.split(/[._-]/)[0]`，对完整工具名 `pg.query` 取到 server 前缀 `pg`，不在读前缀表 → 读类 MCP 方法在 plan 模式被 deny。
- Impact: plan 模式无法使用「查询」类 MCP 工具（spec：plan 模式只读放行）。
- Fix: 判定只看首个点之后的方法段（`query`/`get_file`）；新增 `pg.query`/`figma.get_file`/`pg.exec`/`slack.post` 单测。

### P2：`app_runs` 的 `UNIQUE(session_id, created_at)` 引入同毫秒故障面
- File: `src/infrastructure/sqlite/migrations/011_app_runs.sql`
- Trigger: 同一会话两次 Run 若落在同一毫秒，第二次 INSERT 抛约束冲突，Run 启动失败；同毫秒排序也不稳定。
- Impact: 理论上的启动失败与列表乱序（同会话单飞已把并发挡在 Registry，但时间戳不是幂等保证）。
- Fix: 删除该 UNIQUE（id 已是 PK，不需要第二唯一键）。

### P2：MCP 同一服务并发 connect 产生双连接/状态丢失
- File: `src/runtime/mcp/mcp-manager.ts` `connect`
- Trigger: 两个 connect 并发时第二个不会短路 `connecting` 状态，覆盖 `states` 条目；第一个连接泄漏且工具注册可被第二个覆盖。
- Impact: 双 stdio 子进程、连接状态与工具列表不一致。
- Fix: 每个服务共享一个 in-flight Promise（`connecting` map），并发调用返回同一结果；测试断言只创建一个 transport。

### P3：MCP 连接失败后旧工具仍留在注册表
- File: `src/runtime/mcp/mcp-manager.ts` `connectOnce` catch
- Trigger: 服务从 connected 变为 error（含工具名冲突），`serverTools` 里的旧 id 未注销。
- Impact: 服务不可用仍出现在下一 Run 快照，调用时才报「未连接」。
- Fix: catch 里 `unregisterServerTools(serverId)`；新增失败注销测试。

### P3：SecretStore 写盘失败后内存与磁盘不一致
- File: `src/infrastructure/secrets/encrypted-file-secret-store.ts`
- Trigger: `persist`（写 tmp + rename）抛错时 `#cache` 已更新，磁盘未变；重启后读到旧值。
- Fix: persist 失败时置 `#cache = undefined` 后重新抛错；另修复 `isSecretFileShape` 接受 `secrets: null/[]` 导致 `Object.entries` 抛未包装 TypeError（新增 null/数组用例）。

### P3：技能资源包含性判定在 Windows 大小写敏感
- File: `src/infrastructure/skills/fs-skill-loader.ts` `isPathInside`
- Trigger: 路径前缀比较未归一大小写，Windows 上同一路径不同大小写被误判越界。
- Fix: normalize 后统一 lowercase 比较。

### P3：MCP stdio 子进程在应用退出时可能残留
- File: `src/runtime/mcp/mcp-manager.ts`（缺 dispose）、`src/main/bootstrap/create-legacy-runtime.ts`
- Trigger: 应用退出只关 SQLite/Runtime，不关已连接 transport。
- Fix: McpManager 增加 `dispose()`（断开全部连接、注销 MCP 工具），接入 Runtime dispose 链；测试覆盖。

### P3：工具工厂读取运行中 registry，与 Run 快照不一致
- File: `src/main/bootstrap/create-application.ts` tools factory
- Trigger: 工厂用 `toolRegistry.snapshot()` 而非 `invocation.tools`；运行中设置变更可能影响本次 Run 工具集，与已持久化的能力快照漂移。
- Fix: 使用 `invocation.tools ?? toolRegistry.snapshot()`，与 C12 快照同源。

### P3：技能目录读取竞态未捕获
- File: `src/infrastructure/skills/fs-skill-catalog.ts` `collectGroup`
- Trigger: `existsSync` 与 `readdirSync` 之间目录被删/权限变化时直接抛错。
- Fix: readdirSync 包 try/catch 并记录诊断后继续。

## Fresh Review（修复复核）

对上述 10 项逐条重读修复点与覆盖测试：

- `run-coordinator.test.ts`（run-1 可见）、`mcp-manager.test.ts`（并发 1 个 transport、失败注销、dispose、方法段判定）、`secret-store.test.ts`（null/数组格式）、全量 `bun test` 296/296、architecture、typecheck、build 全过。
- 复核结论：clean（主机自证，独立性弱于独立 reviewer；修复点均有单测或集成测试覆盖）。

## 遗留 Open Questions（非 bug）

- Run 账本随会话删除无清理策略（M4 与 Blob 引用清理一并决策）。
- MCP http 使用 SSE transport，SDK 的 streamable http 留后续。
- 内置技能根依赖 `process.cwd()/assets`，打包目录策略留 M6。
