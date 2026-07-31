# Agent Runtime 门面收口 Spec Diff

## 基线

- Host spec：`.ship/tasks/agent-runtime-facade/plan/spec.md`
- Peer spec：`.ship/tasks/agent-runtime-facade/plan/peer-spec.md`
- 代码基线：`22389e4612eb30648f17335b4365ae0eefd06e3b`
- Peer：Claude CLI 403 后使用 fresh same-provider fallback，独立性弱于跨模型 peer。

## 分歧 1 · 门面事件和 Host 局部命名

- Host 初稿：只迁移 `TgBuddyRuntime`、factory 和 dependencies；保留 `RuntimeEvent*`、`TgBuddyApplication.runtime` 与 `registerIpc(runtime)`。
- Peer：事件发布器应同步使用 `AgentRuntimeEvent*`；Electron application 字段和 IPC 参数应使用 `agentRuntime`，否则数据流仍有泛化命名。
- 证据：`runtime-events.ts` 的类型全部只服务于 Runtime 门面发布器。[src/runtime/app/runtime-events.ts:1-26] `TgBuddyApplication.runtime` 没有生产消费者，Main 只持有 application 并调用 `dispose()`。[src/main/bootstrap/create-application.ts:34-38] [src/main/index.ts:68-84] `registerIpc()` 参数是 Host Adapter 对门面的唯一依赖。[src/main/ipc.ts:16-24]
- 结论：**conceded**。Host spec 已增加事件文件/类型/factory 的原地迁移，并将 application 字段和 IPC 参数改为 `agentRuntime`。

## 分歧 2 · Runtime/Coordinator 是否保留 send

- Host：Renderer/Preload 保留用户动作 `send`，Runtime 和 Coordinator 改用 `start`，输入改为 shared run contract 的 `StartRunInput`。
- Peer：保持 `SendInput`、`runtime.runs.send()` 和 `RunCoordinator.send()`，第二个 Slice 改做 Agent Engine Port 显式化。
- 证据：`SendInput` 当前定义在 IPC contract，却被 Runtime 和 Main compatibility invocation factory直接引用。[src/shared/contracts/ipc.ts:75-80] [src/runtime/runs/run-coordinator.ts:5-20] [src/main/bootstrap/create-legacy-runtime.ts:22-22] `RunCommands` 位于 `runs` 分组，`runs.start()` 能准确表达创建一次 Run；Renderer/Preload 的 `agent.send()` 则准确表达用户动作。[src/runtime/app/tgbuddy-runtime.ts:54-58] [src/preload/index.ts:39-46] 用户已明确要求函数和端口命名符合语义、消息进入 Agent Runtime 后流程清晰。
- 结论：**proven-false**。保留运行层 `send()` 无法解决本任务已确认的语义混用和 IPC 类型归属问题。采用 `StartRunInput` + `runs.start()` + `RunCoordinator.start()`；继续保留 fire-and-forget `void` 行为和 IPC wire。

## 分歧 3 · AgentEngine 是否增加 Port 后缀并移动

- Host：保留 `AgentEngine`、`AgentInvocation` 和当前文件位置；其注释和依赖方向已经表明 Port 语义。
- Peer：移动到 `src/runtime/runs/ports/agent-engine.ts`，重命名为 `AgentEnginePort`、`AgentRunInvocation`，并同步修改 Pi、probe 和全部 fake。
- 证据：现有 Runtime Port 命名风格是能力/角色本身：`SessionRepository`、`MessageStore`、`ContextCompactor`、`ToolPolicy`，没有统一 `Port` 后缀。[src/runtime/sessions/session-repository.ts:9-18] [src/runtime/sessions/message-store.ts:24-36] [src/runtime/context/ports/context-compactor.ts:34-43] [src/runtime/runs/agent-engine.ts:38-68] 架构检查已经把 `*-engine.ts` 识别为 Runtime Port，kernel/pi 当前合法依赖。[scripts/check-architecture.ts:292-296] [src/kernel/pi/pi-agent-engine.ts:18-21]
- 结论：**proven-false**。增加 `Port` 后缀会破坏现有命名一致性，并扩大到 kernel/probe 而没有改善当前数据流。`AgentEngine` 继续作为清晰的 Port；本任务不移动文件。

## 分歧 4 · Slice 数量与提交边界

- Host：两个 Slice，R01 门面收口，R02 Run start 语义链。
- Peer：两个 Slice，AR01 门面/事件收口，AR02 Agent Engine Port 显式化。
- 证据：两边都确认原子 rename 不得以 alias 拆分，且用户要求一个 Slice 一个 commit。Host 接受 Peer 对 R01 的事件和 Host 局部命名补强；R02 按分歧 2/3 的代码证据选择 Run start 语义链。
- 结论：**patched**。最终仍为两个顺序 Slice；R01 扩充事件/Host 命名，R02 收口 `StartRunInput/start()`。

## 最终状态

- patched：1
- conceded：1
- proven-false：2
- escalated：0

所有分歧均由当前代码、现有命名惯例和已定用户语义解决，无需用户再次选择。
