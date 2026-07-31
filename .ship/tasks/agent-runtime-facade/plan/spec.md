# Agent Runtime 正式门面收口规格

## 基线

- Scope mode：`refactor`
- 分支：`main`
- 基线 HEAD：`22389e4612eb30648f17335b4365ae0eefd06e3b`
- 本任务位于 M1 完成与 M2/S01 开始之间，不改变产品行为。

## 问题与动机

当前真实发送路径已经经过 Runtime：Renderer 的 `send()` 调用 `window.tgbuddy.agent.send()`，Preload 将其映射为 `agent:send` IPC，Main handler 再调用 Runtime 门面。[src/renderer/App.tsx:91-112] [src/preload/index.ts:39-46] [src/main/ipc.ts:81-90]

边界已经存在，但名称没有完整表达语义：

- 对外门面仍叫 `TgBuddyRuntime`，工厂叫 `createTgBuddyRuntime()`，依赖集合叫过于宽泛的 `RuntimeDependencies`。[src/runtime/app/tgbuddy-runtime.ts:97-144]
- Runtime 和 `RunCoordinator` 都用 `send()` 表示“启动一次 Run”，与 Renderer/Preload 的用户动作 `send()` 混为同一词。[src/runtime/app/tgbuddy-runtime.ts:54-58] [src/runtime/runs/run-coordinator.ts:39-43]
- Runtime 的运行输入直接使用定义在 IPC contract 中的 `SendInput`，使领域命名从宿主协议倒灌到运行编排。[src/shared/contracts/ipc.ts:75-80] [src/runtime/runs/run-coordinator.ts:5-20]
- `createApplication()` 正确地先创建 `PiAgentEngine` 再注入 compatibility composition，但其公开类型仍是旧门面名。[src/main/bootstrap/create-application.ts:34-51] [src/main/bootstrap/create-application.ts:79-99]

目标不是新增抽象或第二套 Runtime，而是把现有唯一 owner 用稳定、可解释的名称正式收口。

## 已验证架构

`RunCoordinator` 已经依赖 `AgentEngine` Port，通过 `AsyncIterable<AgentEvent>` 驱动一次 Run；它负责同 Session 单飞、Session 生命周期、Invocation 构造、Context hook、事件包装、错误和停止收尾。[src/runtime/runs/run-coordinator.ts:17-44] [src/runtime/runs/run-coordinator.ts:65-107] [src/runtime/runs/run-coordinator.ts:110-242]

`AgentEngine` 只暴露 `run(invocation, signal)` 与 `dispose()`，没有 pi 类型。[src/runtime/runs/agent-engine.ts:56-68] `PiAgentEngine` 位于 `src/kernel/pi/**` 并实现该 Port，内部创建 `AgentHarness`、订阅事件、调用 `prompt()` 并桥接 abort。[src/kernel/pi/pi-agent-engine.ts:103-151] [src/kernel/pi/pi-agent-engine.ts:195-223]

Main IPC 只依赖 `src/runtime/index.ts` 的公共门面，架构检查也禁止 Main IPC 穿透 Runtime 内部或具体 adapter。[src/main/ipc.ts:8-18] [scripts/check-architecture.ts:31-54] [tests/unit/architecture/import-boundaries.test.ts:93-123]

## 设计决策

### 1. 两个小型 Slice，不做一次大范围改名

本任务拆为两个顺序 Slice，每个 Slice 独立 RED、GREEN、验证、peer review 和 commit：

1. **R01 · AgentRuntime 正式门面**：只收口门面、工厂、依赖集合和文件名。
2. **R02 · Run start 语义链**：只收口运行输入和启动命令词汇。

两个 Slice 修改部分相同文件，因此必须顺序执行，不能并行。

### 2. 正式门面命名

R01 的目标签名：

```ts
export interface AgentRuntime {
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  runs: RunCommands
  permissions: PermissionCommands
  plans: PlanCommands
  questions: AskUserCommands
  context: ContextCommands
  artifacts: ArtifactQueries
  capabilities: CapabilityCommands
  settings: SettingsCommands
  subscribe(listener: AgentRuntimeEventListener): () => void
  dispose(): Promise<void>
}

export interface AgentRuntimeDependencies {
  // 现有 dependency members 保持不变；R02 只改 runs 的启动方法名。
}

export function createAgentRuntime(
  dependencies: AgentRuntimeDependencies,
): AgentRuntime
```

实现文件从 `src/runtime/app/tgbuddy-runtime.ts` 移到 `src/runtime/app/agent-runtime.ts`。不保留 `TgBuddyRuntime`、`createTgBuddyRuntime`、`RuntimeDependencies` 的兼容 alias；仓库内调用者一次性迁移，避免形成两个长期公共名称。

`src/runtime/app/runtime-events.ts` 同步移到 `src/runtime/app/agent-runtime-events.ts`，并将 `RuntimeEvent`、`RuntimeEventListener`、`RuntimeEventPublisher`、`createRuntimeEventPublisher()` 分别收口为 `AgentRuntimeEvent`、`AgentRuntimeEventListener`、`AgentRuntimeEventPublisher`、`createAgentRuntimeEventPublisher()`。这些名称只描述门面事件发布器，不创建第二个 Runtime。

`TgBuddyApplication` 保留：它表达 TgBuddy Electron 应用生命周期，不是 Agent Runtime 门面；其字段从 `runtime` 改为 `agentRuntime`。`registerIpc()` 的参数同样命名为 `agentRuntime`，让 Host Adapter 的依赖在调用点可直接识别。[src/main/bootstrap/create-application.ts:28-46] [src/main/ipc.ts:16-24]

### 3. 用户动作与运行命令使用不同词汇

Renderer/Preload/IPC 的用户动作保持：

```ts
window.tgbuddy.agent.send(input)
IPC.AGENT_SEND // 'agent:send'
```

Runtime 内部统一使用：

```ts
export interface StartRunInput {
  sessionId: string
  text: string
  invokeSkill?: string
}

interface RunCommands {
  start(input: StartRunInput): void
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
}

interface RunCoordinator {
  start(
    input: StartRunInput,
    emit: (frame: StreamFrame) => void,
  ): Promise<void>
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
  dispose(): Promise<void>
}
```

`StartRunInput` 放在 `src/shared/contracts/run.ts`：它既是 Runtime 命令 DTO，也是 `agent:send` IPC request 的可序列化契约。`src/shared/contracts/ipc.ts` 只引用它，不再定义 `SendInput`。这样 Host Adapter 仍表达“send”，Runtime 编排表达“start run”。

`AgentEngine.run()`、`AgentHarness.prompt()`、`RunRegistry.start()` 保持不变：三个名称分别表达“执行内核”“向 Harness 提交 Prompt”“在 Registry 建立 active run”，没有语义冲突。[src/runtime/runs/agent-engine.ts:62-68] [src/runtime/runs/run-registry.ts:25-46] [src/kernel/pi/pi-agent-engine.ts:219-223]

`AgentEngine` 继续作为 Port 类型名，不增加 `Port` 后缀，也不移动到新的 `ports/` 目录。现有 Runtime Port 一贯按能力命名为 `SessionRepository`、`MessageStore`、`ContextCompactor` 和 `ToolPolicy`；`AgentEngine` 的注释已经明确它是“Agent 内核端口”，架构检查也把 `*-engine.ts` 识别为 Runtime Port。[src/runtime/sessions/session-repository.ts:9-18] [src/runtime/sessions/message-store.ts:24-36] [src/runtime/context/ports/context-compactor.ts:34-43] [src/runtime/runs/agent-engine.ts:38-68] [scripts/check-architecture.ts:292-296]

### 4. Compatibility 边界保持显式

`createLegacyRuntime()` 暂不删除或伪装为正式工厂。它继续负责把尚未迁移的 Main permission、plan、question、channel、workspace compatibility owner 组装为 `AgentRuntimeDependencies`，最后调用正式的 `createAgentRuntime()`。[src/main/bootstrap/create-legacy-runtime.ts:1-44] [src/main/bootstrap/create-legacy-runtime.ts:85-135]

R01/R02 不将 Node 文件系统、Main service、SQLite 或 pi import 移入 `src/runtime/**`，也不提前实施 S01 Workspace catalog、S03 ExecutionEnv 或 S05 Permission Policy。

## 逐 Slice 文件范围

### R01 · AgentRuntime 正式门面

- 移动并修改 `src/runtime/app/tgbuddy-runtime.ts` → `src/runtime/app/agent-runtime.ts`
- 移动并修改 `src/runtime/app/runtime-events.ts` → `src/runtime/app/agent-runtime-events.ts`
- 修改 `src/runtime/index.ts`
- 修改 `src/runtime/sessions/session-commands.ts`
- 修改 `src/main/ipc.ts`
- 修改 `src/main/bootstrap/create-application.ts`
- 修改 `src/main/bootstrap/create-legacy-runtime.ts`
- 移动并修改 `tests/unit/runtime/tgbuddy-runtime.test.ts` → `tests/unit/runtime/agent-runtime.test.ts`
- 修改 `tests/unit/architecture/import-boundaries.test.ts`
- 更新 `docs/06-设计决策.md`、`docs/07-代码仓库设计.md`、`docs/DOCS_INDEX.md`

R01 会触及 7 个生产文件路径，略高于默认 6 文件护栏。门面定义、事件发布器、public barrel、唯一 Runtime 内部直接消费者以及 Main 的 Composition/IPC 三处必须在同一提交完成；保留旧 alias 或拆出不能独立编译的中间提交都会制造双入口。

### R02 · Run start 语义链

- 修改 `src/shared/contracts/run.ts`
- 修改 `src/shared/contracts/ipc.ts`
- 修改 `src/runtime/app/agent-runtime.ts`
- 修改 `src/runtime/runs/run-coordinator.ts`
- 修改 `src/main/ipc.ts`
- 修改 `src/main/bootstrap/create-legacy-runtime.ts`
- 修改所有直接构造或调用 `RunCoordinator`/Runtime run command 的测试
- 更新 `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`
- 更新 `docs/07-代码仓库设计.md`、`docs/08-项目进度.md`、`docs/DOCS_INDEX.md`

## 非目标

- 不改 `agent:send`、`agent:stop`、`agent:stream` 通道名或 wire shape。
- 不改 `window.tgbuddy.agent.send/stop/onStream`。
- 不改 Renderer 组件、状态、事件路由或视觉行为。
- 不改 Session、Context、Permission、Plan、Question 的业务规则。
- 不改 `PiAgentEngine` 或 `AgentHarness` 行为。
- 不删除 `createLegacyRuntime()` 或迁移其剩余 compatibility owner。
- 不新建 `src/agent-runtime/**`，现有 `src/runtime/**` 就是业务核心。
- 不引入通用 DI 容器、service locator、兼容 alias 或 re-export 旧名称。

## 禁止捷径

- 不允许同时保留 `TgBuddyRuntime` 与 `AgentRuntime`。
- 不允许同时保留 Runtime/Coordinator 的 `send()` 与 `start()`。
- 不允许通过修改架构豁免让 Runtime import Main、Node、SQLite、Electron 或 pi。
- 不允许改动测试断言来跳过真实调用链验证。
- 不允许把 `createLegacyRuntime()` 改名为正式工厂来掩盖 compatibility 依赖。
- 不允许修改 IPC/Preload/Renderer API 以减少内部迁移工作。

## 验收标准

1. `src/runtime/app/agent-runtime.ts` 是唯一 Agent Runtime 门面 owner，并导出 `AgentRuntime`、`AgentRuntimeDependencies`、`createAgentRuntime()`。
2. `src/runtime/app/agent-runtime-events.ts` 是唯一门面事件 owner，并导出 `AgentRuntimeEvent`、`AgentRuntimeEventListener`、`AgentRuntimeEventPublisher`、`createAgentRuntimeEventPublisher()`。
3. `src/runtime/app/tgbuddy-runtime.ts` 与 `src/runtime/app/runtime-events.ts` 不存在；`src/**` 与 `tests/**` 中不存在 `TgBuddyRuntime`、`createTgBuddyRuntime`、`RuntimeDependencies`、旧 `RuntimeEvent*` 标识或 `tgbuddy-runtime`。
4. `TgBuddyApplication.agentRuntime` 与 `registerIpc(agentRuntime, ...)` 清楚表达 Host Adapter 依赖；IPC handler 不能直接依赖 Coordinator 或 kernel。
5. Renderer/Preload 保持 `agent.send(input)` 和 `agent:send` IPC 不变；Main handler 将该请求唯一映射为 `agentRuntime.runs.start(input)`。
6. `StartRunInput` 由 `src/shared/contracts/run.ts` 定义，IPC contract、AgentRuntime、RunCoordinator 和 compatibility invocation factory 使用同一类型；`SendInput` 不再存在。
7. `RunCommands`、`AgentRuntimeDependencies.runs` 与 `RunCoordinator` 只暴露 `start/stop/isRunning`；不存在运行层 `send()`。
8. `RunCoordinator.start()` 保持当前单飞、跨 Session 并行、停止、事件顺序、Session settled、Context hook 与 dispose 行为。
9. `createLegacyRuntime()` 仍明确存在且返回 `AgentRuntime`，最终调用 `createAgentRuntime()`；未迁移 owner 不新增第二个产品入口。
10. `bun run check:architecture`、`bun run typecheck`、`bun test` 和 `bun run build` 全部通过。
11. 文档中的 `AgentRuntime -> RunCoordinator -> AgentEngine -> PiAgentEngine -> AgentHarness` 与代码命名一致，`docs/07-代码仓库设计.md` 状态更新为 `current`。
12. R01 与 R02 各自有独立 Conventional Commit，且每个 commit 只包含该 Slice 与必要文档/测试。

## 测试计划

### R01

- RED：将门面契约测试改为导入 `createAgentRuntime`、`AgentRuntimeDependencies`、`AgentRuntimeEvent`，并将架构 fixture 改为 `AgentRuntime`；确认旧实现编译/测试失败。
- GREEN：完成文件移动和符号迁移。
- 定向：`bun test tests/unit/runtime/agent-runtime.test.ts tests/unit/architecture/import-boundaries.test.ts`
- Gate：`bun run check:architecture && bun run typecheck`

### R02

- RED：将门面和 Coordinator 测试改为 `start()` 与 `StartRunInput`；确认旧实现编译/测试失败。
- GREEN：迁移 shared contract、Runtime、Coordinator、Main handler 和所有调用者。
- 定向：`bun test tests/unit/runtime/agent-runtime.test.ts tests/integration/run-coordinator.test.ts tests/integration/run-settled.test.ts tests/integration/run-recovery.test.ts tests/agent-concurrency.test.ts`
- Gate：`bun run check:architecture && bun run typecheck && bun test && bun run build`

## 风险

- 纯符号迁移的最大风险是漏掉测试或 production import；以 `rg` 零匹配和 TypeScript gate 双重防守。
- 将 `StartRunInput` 放到 shared run contract 会改变类型来源但不改变序列化 shape；IPC contract test/typecheck 必须证明 wire API 不变。
- `RunCoordinator` 方法依赖实例私有字段，门面必须继续用闭包调用 owner，不能裸转交方法导致 `this` 丢失。[src/runtime/app/tgbuddy-runtime.ts:182-188] [tests/unit/runtime/tgbuddy-runtime.test.ts:92-117]
- 文档先于实现写入，R02 完成前 `docs/07-代码仓库设计.md` 必须保持 `partially-outdated`，不能提前标记 `current`。
