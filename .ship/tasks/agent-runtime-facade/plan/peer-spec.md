# Agent Runtime 门面收口：独立 Peer Spec

## 1. 调查基线与结论

- 调查基线为 `22389e4612eb30648f17335b4365ae0eefd06e3b`。当前工作树中的设计文档和 `.ship/tasks/agent-runtime-facade/plan/spec.md` 已有他人改动；本调查没有读取 host spec，也不把未提交文档当作代码事实。
- 这不是新增 Runtime 或重写运行链路的任务。现有门面已经组合 Session、Run、权限、上下文、Artifact、Capability 和 Settings，并集中发布事件；问题是门面仍以 `TgBuddyRuntime`、`createTgBuddyRuntime`、`RuntimeDependencies` 和泛化的 `RuntimeEvent` 命名，无法直接表达它是应用的 Agent Runtime 公共边界（`src/runtime/app/tgbuddy-runtime.ts:97-144`）。
- 真实 Run 链路已经存在：Renderer 通过 `window.tgbuddy.agent.send` 发起请求并通过 `onStream` 消费帧（`src/renderer/App.tsx:99-112`，`src/renderer/hooks/useGlobalAgentListeners.ts:133-153`）；Preload 保持 `agent.send/stop/onStream` API 并映射固定 IPC 通道（`src/preload/index.ts:39-45`）；Main IPC 把 `agent:send`、`agent:stop` 和订阅直接委托给 Runtime 门面（`src/main/ipc.ts:20-23`，`src/main/ipc.ts:82-89`）；门面把发送委托给 Run owner 并把帧送入统一事件发布器（`src/runtime/app/tgbuddy-runtime.ts:182-188`）；`RunCoordinator` 构造 invocation 并消费 `AgentEngine` 的异步事件流（`src/runtime/runs/run-coordinator.ts:133-170`）；`PiAgentEngine` 打开 pi Session、构造 `AgentHarness`、订阅 Harness 事件并执行 `prompt`（`src/kernel/pi/pi-agent-engine.ts:128-151`，`src/kernel/pi/pi-agent-engine.ts:197-223`）。
- 因此应做原地、无兼容别名的命名收口，并把 Agent Engine 明确成 Runtime Port。不得保留旧 factory/type alias，也不得添加一个转发到旧 Runtime 的新 facade；这两种做法都会造成双公共入口。
- 建议拆成 **两个独立 Slice、两个 Conventional Commit**。Slice 1 原子收口公共 `AgentRuntime` 门面；Slice 2 原子收紧 `AgentEnginePort` 及其 Run invocation 命名。两者都是独立的编译期边界改进，并分别有可先失败的类型测试。不要拆成更多提交，因为单次 rename 必须同步修改定义和全部生产调用者，任何临时 alias 都违反“不得创建第二套 Runtime”。

## 2. 已追踪的入口、调用者和消费者

### 2.1 应用启动与装配

1. Electron 主进程只在 `app.whenReady()` 中调用 `createApplication()`，并在退出前调用 application 的 `dispose()`（`src/main/index.ts:67-84`）。
2. `createApplication()` 是唯一 Electron Composition Root；它打开 SQLite repository、创建 pi Session store、恢复中断 Run，然后将 `createPiAgentEngine()` 的结果交给 `createLegacyRuntime()`，最后把返回的 Runtime 注册进 IPC（`src/main/bootstrap/create-application.ts:41-46`，`src/main/bootstrap/create-application.ts:47-99`）。
3. `createLegacyRuntime()` 文件头已经声明其是 Compatibility adapter、列出后续删除期限，并禁止成为第二个长期门面（`src/main/bootstrap/create-legacy-runtime.ts:1-8`）。它在 Main 层创建 `ContextService`、`RunCoordinator` 和仍待迁移的 permission/plan/question/channel 组合，然后调用当前 Runtime factory（`src/main/bootstrap/create-legacy-runtime.ts:42-55`，`src/main/bootstrap/create-legacy-runtime.ts:85-135`）。
4. `createAgentInvocation()` 当前仍在该 compatibility composition 内完成 channel、model、permission mode、workspace 目录和 system prompt 解析，且直接使用 Node 文件系统；这说明它不能在本次改名中被搬进 `src/runtime`（`src/main/bootstrap/create-legacy-runtime.ts:138-172`，`src/main/bootstrap/create-legacy-runtime.ts:194-201`）。

### 2.2 请求前向链路

1. 公共 wire contract 将通道固定为 `agent:send`、`agent:stop`、`agent:stream`，`SendInput` 固定为 `sessionId/text/invokeSkill?`，而 Renderer API 固定为 `window.tgbuddy.agent.send/stop/onStream`（`src/shared/contracts/ipc.ts:30-45`，`src/shared/contracts/ipc.ts:75-80`，`src/shared/contracts/ipc.ts:145-172`）。
2. Preload 只把这三个 API 映射到对应 IPC 通道，不接触 Runtime（`src/preload/index.ts:11-13`，`src/preload/index.ts:39-45`）。
3. `registerIpc()` 当前接收 `TgBuddyRuntime`，订阅其事件并转发 `AGENT_STREAM`，同时把 `AGENT_SEND/STOP` 委托给 `runtime.runs`（`src/main/ipc.ts:9-23`，`src/main/ipc.ts:82-89`）。
4. Runtime 门面的 `runs.send()` 保持 fire-and-forget：调用 coordinator 的异步 `send()` 但向 IPC 返回 `void`；`stop/isRunning` 用闭包保留原 owner 的实例接收者（`src/runtime/app/tgbuddy-runtime.ts:182-188`）。
5. `RunCoordinator` 的公开 contract 是 `send/stop/isRunning/dispose`；`send` 先通过 `RunRegistry` 实现同 Session single-flight，再执行内部 operation（`src/runtime/runs/run-coordinator.ts:39-44`，`src/runtime/runs/run-coordinator.ts:65-93`）。它在 lifecycle started 后创建 immutable invocation，并把该 invocation 与 `AbortSignal` 交给 engine（`src/runtime/runs/run-coordinator.ts:122-150`）。
6. Runtime 侧 `AgentEngine` contract 目前只有 `run(invocation, signal): AsyncIterable<AgentEvent>` 和 `dispose()`，且注释已经说明它是“Agent 内核端口”（`src/runtime/runs/agent-engine.ts:56-68`）。
7. `PiAgentEngine` 是该 port 的唯一生产实现。它是 `src/kernel/pi` 内部类，factory 对 Composition Root 暴露 port；具体 `AgentHarness`、pi `Session`、pi message 和 model 类型均留在 `src/kernel/pi`（`src/kernel/pi/pi-agent-engine.ts:1-21`，`src/kernel/pi/pi-agent-engine.ts:105-119`，`src/kernel/pi/pi-agent-engine.ts:447-450`）。

### 2.3 事件反向链路

1. `PiAgentEngine` 把 Harness 回调桥接为 `AsyncIterable<AgentEvent>`，并在 `message_end` 对持久化结果做一致性检查（`src/kernel/pi/pi-agent-engine.ts:195-209`，`src/kernel/pi/pi-agent-engine.ts:377-401`）。
2. `RunCoordinator` 给 Agent event 补齐 `sessionId/runId/channel`，处理 terminal event、Session settled、host error 和中止语义，然后调用上游 `emit`（`src/runtime/runs/run-coordinator.ts:150-170`，`src/runtime/runs/run-coordinator.ts:191-242`，`src/runtime/runs/run-coordinator.ts:245-266`）。
3. Runtime 门面把 Coordinator frame 与宿主响应统一写入同一个 publisher，并在 `subscribe()` 暴露给 Main IPC（`src/runtime/app/tgbuddy-runtime.ts:145-153`，`src/runtime/app/tgbuddy-runtime.ts:190-242`）。
4. Main IPC 只把订阅得到的 `StreamFrame` 推送给 Renderer；Renderer 按 run cursor、channel 和 event type 更新本地状态（`src/main/ipc.ts:20-23`，`src/renderer/hooks/useGlobalAgentListeners.ts:133-153`）。

## 3. 目标设计与命名契约

### 3.1 唯一公共门面

`src/runtime/app/agent-runtime.ts` 是唯一 Agent Runtime facade 定义文件，替换而不是并存于 `tgbuddy-runtime.ts`：

| 当前名称 | 目标名称 | 语义 |
|---|---|---|
| `TgBuddyRuntime` | `AgentRuntime` | Electron IPC 可以调用的唯一应用 Agent Runtime 公共门面 |
| `createTgBuddyRuntime` | `createAgentRuntime` | 只组合显式 domain dependencies 的唯一门面 factory |
| `RuntimeDependencies` | `AgentRuntimeDependencies` | 创建 `AgentRuntime` 所需的 Runtime-side collaborators |
| `RuntimeEvent` | `AgentRuntimeEvent` | `AgentRuntime.subscribe()` 发布的 `StreamFrame` |
| `RuntimeEventListener` | `AgentRuntimeEventListener` | Agent Runtime event listener |
| `RuntimeEventPublisher` | `AgentRuntimeEventPublisher` | 门面内部 publisher，不是第二个 Runtime |
| `createRuntimeEventPublisher` | `createAgentRuntimeEventPublisher` | 创建上述内部 publisher |

`src/runtime/app/runtime-events.ts` 同步原地移动为 `src/runtime/app/agent-runtime-events.ts`。旧文件、旧类型、旧 factory 必须删除；不得保留 deprecated alias、re-export alias 或 wrapper factory。

门面领域分组 `workspaces/sessions/runs/permissions/plans/questions/context/artifacts/capabilities/settings`、方法签名、事件 payload、清理顺序和 `dispose()` 幂等语义保持不变，因为这些已由现有接口和实现定义（`src/runtime/app/tgbuddy-runtime.ts:23-110`，`src/runtime/app/tgbuddy-runtime.ts:156-249`）。

Main 边界的本地标识同步使用明确名称：

- `registerIpc(agentRuntime: AgentRuntime, ...)`，handler 内只访问 `agentRuntime`。
- `TgBuddyApplication` 的字段从泛化的 `runtime` 改为 `agentRuntime: AgentRuntime`，Composition Root 局部变量也使用 `agentRuntime`。该字段没有生产消费者，现有调用者只使用 application 的 `dispose()`（`src/main/index.ts:20-20`，`src/main/index.ts:68-84`；全仓搜索只在 `src/main/bootstrap/create-application.ts:35-35` 定义该字段）。
- `createLegacyRuntime()` 函数和文件名保持不变，其返回类型改为 `AgentRuntime`，内部唯一最终动作改为 `createAgentRuntime(...)`。文件头的 compatibility/delete-deadline 说明必须保留（`src/main/bootstrap/create-legacy-runtime.ts:1-8`）。

`TgBuddyAPI`、`window.tgbuddy`、`IPC.AGENT_*`、所有 channel string、`IpcCommandMap`、`SendInput` 和 `StreamFrame` 均是跨进程产品/wire contract，不因内部门面改名而改变（`src/shared/contracts/ipc.ts:30-45`，`src/shared/contracts/ipc.ts:93-140`，`src/shared/contracts/ipc.ts:145-172`）。

### 3.2 Agent Engine Port

把 `src/runtime/runs/agent-engine.ts` 原地移动到 feature-local port 位置 `src/runtime/runs/ports/agent-engine.ts`。这与现有 `src/runtime/context/ports/context-compactor.ts` 的端口布局一致，也让架构检查不再依赖“文件名以 engine 结尾”的隐式判定；checker 明确把任何 `/ports/` 目标识别为 Runtime port（`scripts/check-architecture.ts:292-296`）。

精确命名如下：

| 当前名称 | 目标名称 | 语义 |
|---|---|---|
| `AgentEngine` | `AgentEnginePort` | `RunCoordinator` 向 kernel 发起一次 Agent run 的 outbound port |
| `AgentInvocation` | `AgentRunInvocation` | Coordinator 交给 engine 的、每个 Run 不可变的解析后快照 |
| `CreateRunCoordinatorOptions.engine` | `CreateRunCoordinatorOptions.agentEngine` | 明确该依赖不是通用执行引擎 |
| `createInvocation` option/private field | `createAgentRunInvocation` | 将 IPC `SendInput` 解析为 `AgentRunInvocation` |
| `createAgentInvocation()` | `createAgentRunInvocation()` | compatibility composition 内的解析函数 |

`PiAgentEngine implements AgentEnginePort`，`createPiAgentEngine(): AgentEnginePort`；具体类继续留在 `src/kernel/pi/pi-agent-engine.ts` 内部，不要求把 concrete class 变成新的公共 API。`CreatePiAgentEngineOptions.tools()` 的参数改为 `AgentRunInvocation`。Port 仍只使用 shared contract、`AbortSignal`、`AsyncIterable` 和标准 TypeScript 类型，不出现任何 pi/Electron/Node/SQLite 类型（当前 contract 的依赖只有 shared channel/events，见 `src/runtime/runs/agent-engine.ts:1-2`）。

`RunCoordinator` 的行为、接口方法和 factory 名称已经符合领域语义，保持 `RunCoordinator/createRunCoordinator`；只修改其 port 依赖和 invocation 命名。Pi factory 和 `PiAgentEngine` concrete 名称也已经正确，不再引入 `RuntimeEngine`、`HarnessRuntime` 或其他同义抽象。

最终源码中的命名链必须可直接读成：

```text
window.tgbuddy (稳定产品 API)
  -> Electron IPC
  -> AgentRuntime
  -> RunCoordinator
  -> AgentEnginePort
  -> PiAgentEngine
  -> @earendil-works/pi-agent-core AgentHarness
```

## 4. Slice 与逐文件影响

### Slice AR01：唯一 `AgentRuntime` 公共门面

该 Slice 是一次原子 rename。它会触及 7 个生产文件路径，略高于 6 文件默认护栏，但不能再拆：定义文件移动后，public barrel、Runtime 内部消费者、Main composition 和 IPC 必须同一提交编译通过；用旧名 alias 拆提交会制造被明确禁止的第二公共入口。

- **移动 `src/runtime/app/tgbuddy-runtime.ts` → `src/runtime/app/agent-runtime.ts`**：应用 3.1 的门面、factory、dependencies 和 event listener 命名；实现逻辑逐行保持。
- **移动 `src/runtime/app/runtime-events.ts` → `src/runtime/app/agent-runtime-events.ts`**：应用 event publisher 命名；publisher 集合和 subscribe/unsubscribe/clear 行为保持（现实现见 `src/runtime/app/runtime-events.ts:12-26`）。
- **修改 `src/runtime/index.ts`**：只导出新门面/event 名；删除所有旧 re-export（现有旧 exports 位于 `src/runtime/index.ts:1-19`）。
- **修改 `src/runtime/sessions/session-commands.ts`**：把 `SessionCommands` 的 type-only import 指向新 facade 文件；不改变 Session command 实现（当前直接 import 位于 `src/runtime/sessions/session-commands.ts:1-1`）。
- **修改 `src/main/bootstrap/create-legacy-runtime.ts`**：返回并创建唯一 `AgentRuntime`；保留 `createLegacyRuntime`、compatibility 注释和所有旧 service 委托。
- **修改 `src/main/bootstrap/create-application.ts`**：使用 `AgentRuntime/agentRuntime`，返回字段改为 `agentRuntime`，并将其传给 IPC/dispose；不调整 adapter 装配顺序。
- **修改 `src/main/ipc.ts`**：参数类型和局部引用改为 `AgentRuntime/agentRuntime`；所有 IPC 常量、签名和 handler 返回值保持。
- **移动 `tests/unit/runtime/tgbuddy-runtime.test.ts` → `tests/unit/runtime/agent-runtime.test.ts`**：先把 import/describe/helper/event 类型改为新名称形成 Red，再让生产 rename 使其 Green；四个既有行为断言必须原样保留（`tests/unit/runtime/tgbuddy-runtime.test.ts:92-189`）。
- **修改 `tests/unit/architecture/import-boundaries.test.ts`**：合法 Main/Main IPC fixture 改用 `AgentRuntime`，防止架构示例继续传播旧门面名（现 fixture 位于 `tests/unit/architecture/import-boundaries.test.ts:67-87`）。

建议提交：`refactor(runtime): rename facade to AgentRuntime`

### Slice AR02：显式 `AgentEnginePort`

- **移动 `src/runtime/runs/agent-engine.ts` → `src/runtime/runs/ports/agent-engine.ts`**：应用 3.2 的 port 与 invocation 命名；方法签名和行为不变。
- **修改 `src/runtime/runs/run-coordinator.ts`**：改用 `AgentEnginePort`、`AgentRunInvocation`、`agentEngine` 和 `createAgentRunInvocation`；不改变 registry、event、settlement、abort 或 disposal 流程。
- **修改 `src/runtime/index.ts`**：从新 port 路径导出新类型，不导出旧 alias。
- **修改 `src/kernel/pi/pi-agent-engine.ts`**：concrete class 实现新 port，factory 返回新 port，tools/run 参数使用新 invocation 类型；不得改变 Harness 初始化、事件翻译、持久化验证或 abort 流程。
- **修改 `src/main/bootstrap/create-legacy-runtime.ts`**：option 使用 `AgentEnginePort`，解析函数返回 `AgentRunInvocation` 并改为精确名称。
- **修改 `scripts/probe.ts`**：probe fixture 使用 `AgentRunInvocation`；运行场景和断言保持（现有 import/fixture 位于 `scripts/probe.ts:24-49`）。
- **修改 `tests/agent-concurrency.test.ts`、`tests/integration/run-coordinator.test.ts`、`tests/integration/run-recovery.test.ts`、`tests/integration/run-settled.test.ts`**：fake engine 和 invocation 使用新 port 名；现有 concurrency、stream order、recovery、settled/error 测试不得删减（测试覆盖入口见 `tests/agent-concurrency.test.ts:188-223`、`tests/integration/run-coordinator.test.ts:35-83`、`tests/integration/run-recovery.test.ts:80-81`、`tests/integration/run-settled.test.ts:126-266`）。
- **修改 `tests/unit/architecture/import-boundaries.test.ts`**：fixture 使用 `AgentEnginePort`，并继续证明 kernel/infrastructure 可以依赖 Runtime port（现有证明位于 `tests/unit/architecture/import-boundaries.test.ts:67-90`）。

建议提交：`refactor(runtime): make AgentEngine port explicit`

## 5. 非目标

- 不增加第二个 Runtime class/object/factory，不保留旧门面 alias，不做渐进式双入口迁移。
- 不修改 Renderer 组件、atoms、hook 行为或 `window.tgbuddy` API；Renderer 的现有 send/stream 消费已经覆盖目标链路（`src/renderer/App.tsx:99-112`，`src/renderer/hooks/useGlobalAgentListeners.ts:133-153`）。
- 不修改 Preload 实现、`TgBuddyAPI`、IPC channel string、request/response DTO 或 `StreamFrame` shape。
- 不改变 Session/Run/Context/permission/plan/question/channel 的 owner，也不提前完成后续 compatibility 删除 Story。
- 不把 `createAgentRunInvocation()` 搬进 Runtime；它当前依赖 channel store、permission service、Node path/fs 和 DATA_DIR，仍属于 legacy Main composition（`src/main/bootstrap/create-legacy-runtime.ts:9-32`，`src/main/bootstrap/create-legacy-runtime.ts:138-201`）。
- 不把 `PiAgentEngine`、`AgentHarness`、pi model/session/message 类型移入 `src/runtime`。
- 不修改 Run 并发、abort、settlement、compaction、消息持久化、工具事件或 provider error 行为。
- 不引入 DI container、service locator、泛化 `RuntimeEngine` 或无消费者的新 abstraction。
- 不借本任务修改现有脏工作树中的设计文档、进度文档或其他 `.ship` artifacts。

## 6. 禁止捷径

- 禁止 `type TgBuddyRuntime = AgentRuntime`、`const createTgBuddyRuntime = createAgentRuntime`、旧文件 re-export 或双 factory。
- 禁止新建一个只代理旧 `TgBuddyRuntime` 的 `AgentRuntime` wrapper；必须原地重命名现有 owner。
- 禁止为了减少调用点而让 Main IPC 直接依赖 `RunCoordinator`、repository、kernel 或 legacy service；checker 已规定 Main IPC 只能依赖 shared、Runtime 公共门面和 IPC helper（`scripts/check-architecture.ts:392-396`）。
- 禁止让 `src/runtime` import Node、pi、Electron 或 React；checker 已明确拒绝这些依赖（`scripts/check-architecture.ts:337-340`）。
- 禁止让 `PiAgentEngine` 返回 concrete type 给 Main，或让 `RunCoordinator` import `src/kernel/pi`；kernel/pi 只能反向实现 Runtime port（`scripts/check-architecture.ts:373-378`）。
- 禁止改 IPC 名称或 Preload/Renderer API 来“匹配”内部 `AgentRuntime` 名；产品 API 名与内部应用边界名承担不同语义。
- 禁止删除、放宽、跳过现有 facade、Coordinator、Pi adapter、E2E 断言，也禁止用硬编码 event fixture 代替真实委托。
- 禁止把 `create-legacy-runtime.ts` 改名成正式 Runtime 文件，或删除其 compatibility/delete-deadline 注释。

## 7. 验收标准

### AR01

1. `src/runtime/app/agent-runtime.ts` 是唯一 facade owner；它导出 `AgentRuntime`、`AgentRuntimeDependencies`、`createAgentRuntime`。
2. `src/runtime/app/agent-runtime-events.ts` 导出精确的 `AgentRuntimeEvent*` 命名；旧两个文件不存在。
3. `src/runtime/index.ts` 只暴露新名称；活跃源码和测试中不存在旧 `TgBuddyRuntime`、`createTgBuddyRuntime`、`RuntimeDependencies`、泛化 `RuntimeEvent*` 标识。历史 ledger/docs 不属于该零命中检查。
4. `createLegacyRuntime()` 仍是唯一 compatibility composition，且内部只创建一个 `AgentRuntime`。
5. `registerIpc()` 只依赖 `AgentRuntime` 公共门面；所有 IPC 常量、channel string、request/response 和 stream payload 与基线一致。
6. 既有门面测试继续证明：Coordinator 方法 receiver 被保留、会话删除清理顺序不变、Agent/host event 共用订阅契约、active Run 拒绝 delete/truncate/clone（现断言见 `tests/unit/runtime/tgbuddy-runtime.test.ts:93-189`）。

### AR02

1. Runtime outbound port 只有 `AgentEnginePort`，定义在 `src/runtime/runs/ports/agent-engine.ts`；旧 `AgentEngine` 和旧文件不存在。
2. `RunCoordinator` 只依赖 `AgentEnginePort`，通过 `AgentRunInvocation + AbortSignal` 调用 `agentEngine.run()`，并继续返回/发布相同事件。
3. `PiAgentEngine` 是唯一生产实现，继续在 `src/kernel/pi` 内构造外部 `AgentHarness`；factory 只向上返回 `AgentEnginePort`。
4. `src/runtime` 中不存在 `electron`、`node:*`、SQLite、`@earendil-works/pi-*` runtime import；shared 中既有 pi type-only 例外不扩大。
5. 当前 Coordinator 流顺序、single-flight、跨 Session 并行、stop/abort、settled/error，以及 Pi event translation/persistence/compaction 行为全部通过原测试。现有测试分别覆盖 stream order（`tests/integration/run-coordinator.test.ts:35-83`）、并发与停止（`tests/agent-concurrency.test.ts:223-416`）、settled/error（`tests/integration/run-settled.test.ts:126-266`）和 Pi event translation（`tests/unit/kernel/pi-agent-engine.test.ts:48-211`）。

### 最终端到端

1. 从 Renderer send 到 Harness prompt 的正向链和从 Harness event 到 Renderer onStream 的反向链均保持可运行。
2. M1 Electron E2E 的五类行为继续通过：持久化与重启恢复、停止后重发、工具结果回放、自动压缩与排队、编辑重发与克隆（`tests/e2e/m1-runtime.e2e.ts:26-104`）。
3. 没有新增架构豁免；`LEGACY_COMPATIBILITY` 列表不因本任务扩大（现列表由 `scripts/check-architecture.ts:48-55` 定义并在 `tests/unit/architecture/import-boundaries.test.ts:195-202` 锁定）。

## 8. 测试与验证计划

### AR01 RED

1. 先移动/更新 facade unit test，使它只 import `createAgentRuntime`、`AgentRuntimeDependencies` 和 `AgentRuntimeEvent`，并把 suite 名改为“AgentRuntime 门面”。
2. 更新 architecture fixture 只接受 `AgentRuntime`。
3. 在生产代码仍为旧名称时运行：
   - `bun test tests/unit/runtime/agent-runtime.test.ts`
   - `bun test tests/unit/architecture/import-boundaries.test.ts`
4. 预期失败原因必须是新 public symbols/文件尚不存在；不得用兼容 alias 消除 Red。

### AR01 GREEN

- `bun test tests/unit/runtime/agent-runtime.test.ts`
- `bun test tests/unit/architecture/import-boundaries.test.ts`
- `bun run check:architecture`
- `bun run typecheck`
- `bun run build`

### AR02 RED

1. 先把 Coordinator/integration/concurrency 测试 fake 改为 `AgentEnginePort` 和 `AgentRunInvocation`，把 architecture fixture 改为新 port 名与新路径。
2. 在生产 port 仍为旧名称时运行对应测试，预期因新 types/path 不存在而失败；不得保留旧 type alias。

### AR02 GREEN

- `bun test tests/integration/run-coordinator.test.ts tests/integration/run-recovery.test.ts tests/integration/run-settled.test.ts tests/agent-concurrency.test.ts tests/unit/kernel/pi-agent-engine.test.ts`
- `bun test tests/unit/architecture/import-boundaries.test.ts`
- `bun run probe`
- `bun run check:architecture`
- `bun run typecheck`
- `bun test`
- `bun run build`
- `bun run test:e2e`

涉及 `src/kernel/pi/**` 必须运行 probe，涉及 Main/IPC 必须 build；这些命令已经由仓库 scripts 定义（`package.json:11-23`）。

## 9. 风险与控制

- **双入口风险**：最容易为了分步编译而保留旧 alias。控制方式是每个 Slice 原子修改定义和调用者，并把“旧活跃标识零命中”列为验收。
- **异步 wire 语义漂移**：`AgentRuntime.runs.send()` 当前 fire-and-forget，IPC response 是 `void`；若改为 await/Promise，Renderer 时序会变化。必须保留 `void dependencies.runs.send(...)` 语义（`src/runtime/app/tgbuddy-runtime.ts:182-185`，`src/shared/contracts/ipc.ts:117-118`）。
- **方法接收者丢失**：Coordinator 使用私有字段，不能裸传 `stop/isRunning`；现门面用闭包保留 receiver，且 unit test 锁定（`src/runtime/app/tgbuddy-runtime.ts:186-188`，`tests/unit/runtime/tgbuddy-runtime.test.ts:93-117`）。
- **Port 位置与 checker 漂移**：把 contract 放进 `/ports/` 可被 checker 显式识别；若只改成 `agent-engine-port.ts` 且仍放在 `/runs/`，现 filename heuristic 不会把它识别为 port（`scripts/check-architecture.ts:292-296`）。
- **Compatibility 被误正式化**：`createLegacyRuntime()` 同时包含真实 Coordinator 组合和待删 Main service 委托。它必须继续带显式 compatibility 说明，不能因返回 `AgentRuntime` 就被当作长期 owner（`src/main/bootstrap/create-legacy-runtime.ts:1-8`，`src/main/bootstrap/create-legacy-runtime.ts:68-129`）。
- **行为测试被纯 rename 误删**：当前测试覆盖的不只是类型名称，还锁定事件顺序、错误可见性、持久化和中止。更新 import/描述时必须保留全部断言（`tests/integration/run-settled.test.ts:126-266`，`tests/unit/kernel/pi-agent-engine.test.ts:48-211`）。
- **脏工作树冲突**：设计文档和 task 目录已有未提交内容。实现阶段只能暂存各 Slice 明确列出的代码/测试文件，不得覆盖或提交任务外改动。

## 10. 自检结果

- **占位符扫描**：无未完成占位内容；所有目标名、文件、命令和验收均已明确。
- **矛盾扫描**：内部 `AgentRuntime` 改名与外部 `TgBuddyAPI/window.tgbuddy` 保持稳定并不矛盾；前者是应用边界，后者是产品 wire contract。
- **覆盖扫描**：已覆盖启动 Composition Root、Main compatibility composition、IPC、Preload、Renderer、Runtime facade、RunCoordinator、Agent Engine Port、Pi implementation、外部 Harness、反向事件链、测试与 architecture checker。
- **歧义扫描**：明确采用原地替换、两个 Slice、无 alias、`AgentEnginePort` 后缀、feature-local `/ports/` 路径和 `AgentRunInvocation` 名称；不存在“保留旧名一段时间”或“可选目录”的双重解释。
- **未决项**：无。所有关键结论均可由当前基线代码验证。
