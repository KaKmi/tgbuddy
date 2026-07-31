# Agent Runtime 正式门面收口实施计划

> **For agentic workers:** 使用 `/ship:dev` 按 Task 顺序实施。每个 Task 是一个 Slice、一个独立 commit。

**Goal:** 在不改变 IPC、Renderer 和 Agent 行为的前提下，把现有唯一 Runtime owner 收口为语义明确的 `AgentRuntime`，并让消息进入 Runtime 后统一使用 `StartRunInput` 与 `start()` 表达一次 Run 的启动。

**Architecture:** R01 原地替换门面、事件发布器和 Host Adapter 局部命名，不保留旧 alias；R02 保持 Renderer/Preload 的 `agent.send()` wire API，Main IPC 将其翻译为 `agentRuntime.runs.start()`，再由 `RunCoordinator.start()` 调用既有 `AgentEngine.run()`。`createLegacyRuntime()` 继续作为显式 compatibility composition，具体 pi、Electron、Node、SQLite 和文件系统实现仍在 Runtime 外。

**Tech Stack:** TypeScript、Bun Test、Electron typed IPC、`@earendil-works/pi-agent-core`、自定义 architecture checker。

## Global Constraints

- 注释、测试、诊断和文档一律使用中文，保留必要的英文类型名与 API 名。
- R01 与 R02 各自只有一个主要行为、独立 RED/GREEN、独立 peer review、独立 Conventional Commit。
- 不创建第二套 Runtime，不保留 `TgBuddyRuntime`、`createTgBuddyRuntime`、`RuntimeDependencies` 或旧 `RuntimeEvent*` alias/wrapper/re-export。
- Renderer/Preload 保持 `window.tgbuddy.agent.send/stop/onStream`，IPC 保持 `agent:send/agent:stop/agent:stream` 和原 request/response shape。
- Runtime/Coordinator 的运行启动语义固定为 `start()`；用户动作才使用 `send()`。
- `StartRunInput` 的字段固定为 `sessionId: string`、`text: string`、`invokeSkill?: string`，不得改变序列化形状。
- `AgentEngine.run()`、`PiAgentEngine` 和 `AgentHarness.prompt()` 保持现有签名与行为，不增加 `AgentEnginePort` 同义类型。
- `createLegacyRuntime()` 的文件、函数名、compatibility 注释和后续删除期限必须保留，不得伪装成正式工厂。
- Runtime 不得 import Electron、React、Node 文件系统、SQLite、pi、Main 或具体 Infrastructure。
- 门面对 `RunCoordinator.stop/isRunning` 继续使用闭包调用，不能裸传实例方法导致私有字段接收者丢失。
- 不修改 Session、Context、Permission、Plan、Question、Tool、Compaction 或 Renderer 行为，不提前实施 S01。
- 不放宽断言、不 hardcode fixture、不加 skip/xfail、不扩大 architecture compatibility 豁免。
- 只暂存当前 Slice 文件，不使用 `git add .` 或 `git add -A`。

---

### Task 1：R01 · AgentRuntime 正式门面

**Files:**

- Move: `src/runtime/app/tgbuddy-runtime.ts` → `src/runtime/app/agent-runtime.ts`
- Move: `src/runtime/app/runtime-events.ts` → `src/runtime/app/agent-runtime-events.ts`
- Modify: `src/runtime/index.ts`
- Modify: `src/runtime/sessions/session-commands.ts`
- Modify: `src/main/bootstrap/create-legacy-runtime.ts`
- Modify: `src/main/bootstrap/create-application.ts`
- Modify: `src/main/ipc.ts`
- Move: `tests/unit/runtime/tgbuddy-runtime.test.ts` → `tests/unit/runtime/agent-runtime.test.ts`
- Modify: `tests/unit/architecture/import-boundaries.test.ts`
- Modify: `docs/06-设计决策.md`
- Modify: `docs/07-代码仓库设计.md`
- Modify: `docs/DOCS_INDEX.md`
- Create: `.ship/tasks/agent-runtime-facade/plan/spec.md`
- Create: `.ship/tasks/agent-runtime-facade/plan/peer-spec.md`
- Create: `.ship/tasks/agent-runtime-facade/plan/diff-report.md`
- Create: `.ship/tasks/agent-runtime-facade/plan/plan.md`

**Interfaces:**

- Consumes:
  - `StreamFrame`
  - 当前 `WorkspaceCommands`、`SessionCommands`、`RunCommands`、Permission/Plan/Question/Context/Artifact/Capability/Settings contracts
  - `createLegacyRuntime(options: CreateLegacyRuntimeOptions)`
- Produces:
  - `createAgentRuntime(dependencies: AgentRuntimeDependencies): AgentRuntime`
  - `AgentRuntime`
  - `AgentRuntimeDependencies`
  - `AgentRuntimeEvent = StreamFrame`
  - `AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void`
  - `AgentRuntimeEventPublisher`
  - `createAgentRuntimeEventPublisher(): AgentRuntimeEventPublisher`
  - `TgBuddyApplication.agentRuntime: AgentRuntime`
  - `registerIpc(agentRuntime: AgentRuntime, getWindow: () => BrowserWindow | null): () => void`

**Tier:** standard

- [ ] **Step 1：先移动并修改门面测试，制造 RED**

将 `tests/unit/runtime/tgbuddy-runtime.test.ts` 移到 `tests/unit/runtime/agent-runtime.test.ts`，只改类型/工厂/描述和测试内的事件类型，四个行为断言原样保留：

```ts
import { describe, expect, test } from 'bun:test'
import {
  createAgentRuntime,
  type AgentRuntimeDependencies,
  type AgentRuntimeEvent,
} from '../../../src/runtime/index.ts'

function createDependencies(
  calls: string[],
): AgentRuntimeDependencies {
  // 原 fixture 内容原样保留
}

describe('AgentRuntime 门面', () => {
  // 原四个 test 与断言原样保留
})
```

将 `tests/unit/architecture/import-boundaries.test.ts` 合法 fixture 中的 `TgBuddyRuntime` 全部改为 `AgentRuntime`：

```ts
'src/runtime/index.ts': `
  export type { AgentEngine } from './ports/index.ts'
  export interface AgentRuntime {}
`,
'src/main/bootstrap/create-application.ts':
  "import type { AgentRuntime } from '../../runtime/index.ts'\nimport { app } from 'electron'",
'src/main/ipc/register-ipc.ts':
  "import type { AgentRuntime } from '../../runtime/index.ts'\nimport { ipcMain } from 'electron'",
'src/main/window.ts':
  "import type { AgentRuntime } from '../runtime/index.ts'\nimport { BrowserWindow } from 'electron'",
```

- [ ] **Step 2：运行定向测试并确认 RED**

Run:

```powershell
bun test tests/unit/runtime/agent-runtime.test.ts tests/unit/architecture/import-boundaries.test.ts
```

Expected: FAIL；`src/runtime/index.ts` 尚未导出 `createAgentRuntime`、`AgentRuntimeDependencies`、`AgentRuntimeEvent`，不得添加旧名 alias 让测试提前通过。

- [ ] **Step 3：原地迁移门面事件 owner**

将 `src/runtime/app/runtime-events.ts` 移到 `src/runtime/app/agent-runtime-events.ts`，完整实现固定为：

```ts
import type { StreamFrame } from '../../shared/contracts/events.ts'

export type AgentRuntimeEvent = StreamFrame
export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void

export interface AgentRuntimeEventPublisher {
  emit(event: AgentRuntimeEvent): void
  subscribe(listener: AgentRuntimeEventListener): () => void
  clear(): void
}

export function createAgentRuntimeEventPublisher(): AgentRuntimeEventPublisher {
  const listeners = new Set<AgentRuntimeEventListener>()

  return {
    emit(event) {
      for (const listener of listeners) listener(event)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clear() {
      listeners.clear()
    },
  }
}
```

- [ ] **Step 4：原地迁移 AgentRuntime 门面**

将 `src/runtime/app/tgbuddy-runtime.ts` 移到 `src/runtime/app/agent-runtime.ts`，保持所有 command/query 实现和清理顺序，只做以下精确替换：

```ts
import {
  createAgentRuntimeEventPublisher,
  type AgentRuntimeEventListener,
} from './agent-runtime-events.ts'

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
  // 将当前 RuntimeDependencies 的成员逐项原样迁移
}

export function createAgentRuntime(
  dependencies: AgentRuntimeDependencies,
): AgentRuntime {
  const events = createAgentRuntimeEventPublisher()
  // 当前 createTgBuddyRuntime 的其余实现逐行保持
}
```

- [ ] **Step 5：同步公共 barrel、唯一 Runtime 内部消费者和 compatibility composition**

`src/runtime/index.ts` 的开头固定为：

```ts
export {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeDependencies,
  type ArtifactQueries,
  type AskUserCommands,
  type CapabilityCommands,
  type ContextCommands,
  type PermissionCommands,
  type PlanCommands,
  type RunCommands,
  type SessionCommands,
  type SettingsCommands,
  type WorkspaceCommands,
} from './app/agent-runtime.ts'
export type {
  AgentRuntimeEvent,
  AgentRuntimeEventListener,
  AgentRuntimeEventPublisher,
} from './app/agent-runtime-events.ts'
```

`src/runtime/sessions/session-commands.ts` 第一行改为：

```ts
import type { SessionCommands } from '../app/agent-runtime.ts'
```

`src/main/bootstrap/create-legacy-runtime.ts` 只修改正式门面名称：

```ts
import {
  createAgentRuntime,
  type AgentRuntime,
  // 其余 import 原样保留
} from '../../runtime/index.ts'

export function createLegacyRuntime(
  options: CreateLegacyRuntimeOptions,
): AgentRuntime {
  // compatibility 组合原样保留
  return createAgentRuntime({
    // 当前 dependencies 原样保留
  })
}
```

- [ ] **Step 6：同步 Electron Composition Root 与 IPC Host Adapter 语义**

`src/main/bootstrap/create-application.ts` 使用：

```ts
import type { AgentRuntime } from '../../runtime/index.ts'

export interface TgBuddyApplication {
  agentRuntime: AgentRuntime
  migration: LegacyMigrationReport
  recovery: InterruptedRunRecoveryReport
  dispose(): Promise<void>
}

let agentRuntime: AgentRuntime
agentRuntime = createLegacyRuntime({ /* 当前 options 原样保留 */ })
unsubscribe = registerIpc(agentRuntime, options.getWindow)

return {
  agentRuntime,
  migration,
  recovery,
  async dispose() {
    if (disposed) return
    disposed = true
    unsubscribe()
    try {
      await agentRuntime.dispose()
    } finally {
      appDatabase.close()
    }
  },
}
```

`src/main/ipc.ts` 使用 `agentRuntime` 参数，并把函数体内全部 `runtime.` 机械替换为 `agentRuntime.`；handler、常量、请求响应类型和返回行为不得改变：

```ts
export function registerIpc(
  agentRuntime: AgentRuntime,
  getWindow: () => BrowserWindow | null,
): () => void
```

- [ ] **Step 7：验证旧门面名称零匹配**

Run:

```powershell
rg -n "TgBuddyRuntime|createTgBuddyRuntime|RuntimeDependencies|RuntimeEvent(?:Listener|Publisher)?|createRuntimeEventPublisher|tgbuddy-runtime|runtime-events" src tests
```

Expected: exit code 1 且无输出。`AgentRuntimeDependencies` 不应因 substring 被误判，使用正则时必须保持 `RuntimeDependencies` 前没有 `Agent`。

- [ ] **Step 8：运行 R01 GREEN 与 gate**

Run:

```powershell
bun test tests/unit/runtime/agent-runtime.test.ts tests/unit/architecture/import-boundaries.test.ts
bun run check:architecture
bun run typecheck
bun run build
```

Expected: 全部 PASS；build 只允许保留仓库已知的 Vite 主 chunk 体积 warning，不得新增错误或 warning。

- [ ] **Step 9：提交 R01**

Stage only:

```powershell
git add -- `
  src/runtime/app/agent-runtime.ts `
  src/runtime/app/agent-runtime-events.ts `
  src/runtime/app/tgbuddy-runtime.ts `
  src/runtime/app/runtime-events.ts `
  src/runtime/index.ts `
  src/runtime/sessions/session-commands.ts `
  src/main/bootstrap/create-legacy-runtime.ts `
  src/main/bootstrap/create-application.ts `
  src/main/ipc.ts `
  tests/unit/runtime/agent-runtime.test.ts `
  tests/unit/runtime/tgbuddy-runtime.test.ts `
  tests/unit/architecture/import-boundaries.test.ts `
  docs/06-设计决策.md `
  docs/07-代码仓库设计.md `
  docs/DOCS_INDEX.md `
  .ship/tasks/agent-runtime-facade/plan/spec.md `
  .ship/tasks/agent-runtime-facade/plan/peer-spec.md `
  .ship/tasks/agent-runtime-facade/plan/diff-report.md `
  .ship/tasks/agent-runtime-facade/plan/plan.md
git commit -m "refactor(runtime): establish AgentRuntime facade"
```

Expected: 一个 R01 commit；`docs/07-代码仓库设计.md` 仍为 `partially-outdated`，直到 R02 完成。

---

### Task 2：R02 · Run start 语义链

**Files:**

- Modify: `src/shared/contracts/run.ts`
- Modify: `src/shared/contracts/ipc.ts`
- Modify: `src/runtime/app/agent-runtime.ts`
- Modify: `src/runtime/runs/run-coordinator.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/bootstrap/create-legacy-runtime.ts`
- Modify: `tests/unit/runtime/agent-runtime.test.ts`
- Modify: `tests/integration/run-coordinator.test.ts`
- Modify: `tests/integration/run-settled.test.ts`
- Modify: `tests/integration/run-recovery.test.ts`
- Modify: `tests/agent-concurrency.test.ts`
- Modify: `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`
- Modify: `docs/07-代码仓库设计.md`
- Modify: `docs/08-项目进度.md`
- Modify: `docs/DOCS_INDEX.md`
- Create: `.ship/tasks/agent-runtime-facade/dev-context.md`
- Create: `.ship/tasks/agent-runtime-facade/dev-ledger.md`

**Interfaces:**

- Consumes:
  - `createAgentRuntime(dependencies: AgentRuntimeDependencies): AgentRuntime`
  - `AgentEngine.run(invocation: AgentInvocation, signal: AbortSignal): AsyncIterable<AgentEvent>`
  - `IpcCommandMap['agent:send']`
- Produces:
  - `StartRunInput { sessionId: string; text: string; invokeSkill?: string }`
  - `RunCommands.start(input: StartRunInput): void`
  - `AgentRuntimeDependencies.runs.start(input: StartRunInput, emit: (frame: StreamFrame) => void): Promise<void>`
  - `RunCoordinator.start(input: StartRunInput, emit: (frame: StreamFrame) => void): Promise<void>`
  - `CreateRunCoordinatorOptions.createInvocation(input: StartRunInput): Promise<AgentInvocation>`
  - `IpcCommandMap['agent:send'] = IpcCommand<StartRunInput, void>`

**Tier:** standard

- [ ] **Step 1：先迁移测试到 StartRunInput/start，制造 RED**

`tests/unit/runtime/agent-runtime.test.ts` 的 fake dependency 与调用改为：

```ts
runs: {
  async start(_input, emit) {
    calls.push('run.start')
    emit({
      sessionId: 'session-1',
      runId: 1,
      payload: { channel: 'agent', event: { type: 'run_start' } },
    })
  },
  stop: () => calls.push('run.stop'),
  isRunning: () => false,
}

agentRuntime.runs.start({ sessionId: 'session-1', text: '你好' })
expect(calls).toEqual(['run.start', 'permission.respond'])
```

receiver test 的 owner 固定为：

```ts
const owner = {
  active: true,
  start: dependencies.runs.start,
  stop(this: { active: boolean }, sessionId: string) {
    calls.push(`run.stop:${sessionId}:${this.active}`)
  },
  isRunning(this: { active: boolean }, sessionId: string) {
    calls.push(`run.isRunning:${sessionId}:${this.active}`)
    return this.active
  },
}
```

把以下测试文件中所有 `coordinator.send(...)` 机械改为 `coordinator.start(...)`，断言和时序不变：

```text
tests/integration/run-coordinator.test.ts
tests/integration/run-settled.test.ts
tests/integration/run-recovery.test.ts
tests/agent-concurrency.test.ts
```

`tests/agent-concurrency.test.ts` 的输入类型改为：

```ts
import type { StartRunInput } from '../src/shared/contracts/run.ts'

function createInvocation(
  input: StartRunInput,
): Promise<AgentInvocation> {
  // 当前 fixture 原样保留
}
```

- [ ] **Step 2：运行定向测试并确认 RED**

Run:

```powershell
bun test tests/unit/runtime/agent-runtime.test.ts tests/integration/run-coordinator.test.ts tests/integration/run-settled.test.ts tests/integration/run-recovery.test.ts tests/agent-concurrency.test.ts
```

Expected: FAIL；当前 `RunCommands`/`RunCoordinator` 没有 `start()`，shared run contract 没有 `StartRunInput`。

- [ ] **Step 3：建立 shared StartRunInput，并保持 IPC wire**

在 `src/shared/contracts/run.ts` 追加：

```ts
export interface StartRunInput {
  sessionId: string
  text: string
  /** 显式调用的技能名（用户点了 /skill:xxx） */
  invokeSkill?: string
}
```

`src/shared/contracts/ipc.ts` 删除本地 `SendInput`，增加：

```ts
import type { StartRunInput } from './run.ts'
```

并保持 channel 不变，只替换 request 类型：

```ts
'agent:send': IpcCommand<StartRunInput, void>
```

`TgBuddyAPI.agent.send()` 继续从 `IpcRequest<'agent:send'>` 推导，不做任何修改。

- [ ] **Step 4：迁移 AgentRuntime 与 RunCoordinator 启动语义**

`src/runtime/app/agent-runtime.ts` 固定为：

```ts
import type { StartRunInput } from '../../shared/contracts/run.ts'

export interface RunCommands {
  start(input: StartRunInput): void
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
}

export interface AgentRuntimeDependencies {
  // 其余 members 原样保留
  runs: {
    start(
      input: StartRunInput,
      emit: (frame: StreamFrame) => void,
    ): Promise<void>
    stop(sessionId: string): void
    isRunning(sessionId: string): boolean
  }
}

runs: {
  start(input) {
    void dependencies.runs.start(input, events.emit)
  },
  stop: (sessionId) => dependencies.runs.stop(sessionId),
  isRunning: (sessionId) => dependencies.runs.isRunning(sessionId),
},
```

`src/runtime/runs/run-coordinator.ts` 只做精确类型/方法替换：

```ts
import type { StartRunInput } from '../../shared/contracts/run.ts'

export interface CreateRunCoordinatorOptions {
  now(): number
  engine: AgentEngine
  createInvocation(input: StartRunInput): Promise<AgentInvocation>
  lifecycle: RunSessionLifecycle
  context?: Pick<
    ContextService,
    'observeTurn' | 'beforeModelCall' | 'runSettled'
  >
}

export interface RunCoordinator {
  start(
    input: StartRunInput,
    emit: (frame: StreamFrame) => void,
  ): Promise<void>
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
  dispose(): Promise<void>
}

class DefaultRunCoordinator implements RunCoordinator {
  start(
    input: StartRunInput,
    emit: (frame: StreamFrame) => void,
  ): Promise<void> {
    // 当前 send() 方法体逐行保持
  }

  async #execute(
    input: StartRunInput,
    run: ActiveRun,
    emit: (frame: StreamFrame) => void,
  ): Promise<void> {
    // 当前实现逐行保持
  }
}
```

- [ ] **Step 5：把 Host Adapter 的 send 翻译为 Runtime start**

`src/main/ipc.ts` 保持外部 `IPC.AGENT_SEND`，只改 handler 内部调用：

```ts
ipcMain.handle(
  IPC.AGENT_SEND,
  (_event, input: IpcRequest<'agent:send'>): IpcResponse<'agent:send'> =>
    agentRuntime.runs.start(input),
)
```

`src/main/bootstrap/create-legacy-runtime.ts` 改为：

```ts
import type { StartRunInput } from '../../shared/contracts/run.ts'

async function createAgentInvocation(
  input: StartRunInput,
  sessions: SessionCommands,
): Promise<AgentInvocation> {
  // 当前解析行为原样保留
}
```

`createRunCoordinator(...)` 的返回对象直接满足 `AgentRuntimeDependencies.runs`，不增加 wrapper 或 alias。

- [ ] **Step 6：验证旧运行词汇零匹配和 wire API 未改变**

Run:

```powershell
rg -n "\bSendInput\b|coordinator\.send|runs\.send|dependencies\.runs\.send|run\.send" src tests
rg -n "AGENT_SEND: 'agent:send'|send\(input: IpcRequest<'agent:send'>\)" src/shared/contracts/ipc.ts
```

Expected:

- 第一条 exit code 1 且无输出；
- 第二条命中 `agent:send` 常量与 `TgBuddyAPI.agent.send()`，证明 Host wire 名称保持。

- [ ] **Step 7：运行 R02 GREEN 与全量 gate**

Run:

```powershell
bun test tests/unit/runtime/agent-runtime.test.ts tests/integration/run-coordinator.test.ts tests/integration/run-settled.test.ts tests/integration/run-recovery.test.ts tests/agent-concurrency.test.ts
bun run check:architecture
bun run typecheck
bun test
bun run build
```

Expected: 全部 PASS；测试总数不得低于 R02 开始前基线，build 只允许既有 Vite chunk warning。

- [ ] **Step 8：回写长期计划和进度**

更新 `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md`：

```text
已完成基线新增：
R01 | ✅ | AgentRuntime 唯一门面、事件与 Host Adapter 语义
R02 | ✅ | StartRunInput 与 runs/RunCoordinator start 语义链

依赖主链：
K17 -> R01 -> R02 -> S01 -> ... -> S11
```

更新 `docs/07-代码仓库设计.md`：

- frontmatter `status` 改为 `current`；
- Status 改为 R01/R02 已完成；
- Composition Root 明确 `createApplication() -> createLegacyRuntime() -> createAgentRuntime()`；
- 不再写“尚待 R01 收口”。

更新 `docs/08-项目进度.md`：

- Summary 保持下一产品 Slice 为 S01；
- 当前执行指针的前置状态增加 R01/R02 已关闭；
- 里程碑表增加“Agent Runtime 正式门面”R01–R02完成证据；
- 最近产品 Slice 仍为 `f4dad1a`，因为 R01/R02 是行为不变的架构 Slice。

更新 `docs/DOCS_INDEX.md` 的 007 status 为 `current`。

- [ ] **Step 9：提交 R02**

Stage only:

```powershell
git add -- `
  src/shared/contracts/run.ts `
  src/shared/contracts/ipc.ts `
  src/runtime/app/agent-runtime.ts `
  src/runtime/runs/run-coordinator.ts `
  src/main/ipc.ts `
  src/main/bootstrap/create-legacy-runtime.ts `
  tests/unit/runtime/agent-runtime.test.ts `
  tests/integration/run-coordinator.test.ts `
  tests/integration/run-settled.test.ts `
  tests/integration/run-recovery.test.ts `
  tests/agent-concurrency.test.ts `
  .ship/tasks/tgbuddy-vertical-slices/plan/plan.md `
  docs/07-代码仓库设计.md `
  docs/08-项目进度.md `
  docs/DOCS_INDEX.md `
  .ship/tasks/agent-runtime-facade/dev-context.md `
  .ship/tasks/agent-runtime-facade/dev-ledger.md
git commit -m "refactor(runtime): clarify run start semantics"
```

Expected: 一个 R02 commit；下一开发入口仍为 M2/S01。
