import type { ArtifactRef } from '../../shared/contracts/artifact.ts'
import type { CapabilityDescriptor } from '../../shared/contracts/capability.ts'
import type { Channel } from '../../shared/contracts/channel.ts'
import type { HostEvent, StreamFrame } from '../../shared/contracts/events.ts'
import type {
  AskUserRequest,
  AskUserResponse,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  PlanRequest,
  PlanResponse,
} from '../../shared/contracts/permission.ts'
import type { SessionMessage } from '../../shared/contracts/message.ts'
import type { StartRunInput } from '../../shared/contracts/run.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type { Workspace } from '../../shared/contracts/workspace.ts'
import {
  createAgentRuntimeEventPublisher,
  type AgentRuntimeEventListener,
} from './agent-runtime-events.ts'

export interface WorkspaceCommands {
  list(): Workspace[]
  create(input: { path: string }): Workspace
  select(workspaceId: string): Workspace
  current(): Workspace | undefined
}

export interface SessionCommands {
  list(): SessionMeta[]
  create(input: {
    title?: string
    channelId?: string
    modelId?: string
  }): Promise<SessionMeta>
  delete(sessionId: string): Promise<void>
  messages(sessionId: string): Promise<SessionMessage[]>
  compactedMessages(
    sessionId: string,
    compactionId: string,
  ): Promise<SessionMessage[]>
  truncate(
    sessionId: string,
    fromMessageId: string,
  ): Promise<SessionMessage[]>
  clonePrefix(input: {
    sourceSessionId: string
    throughMessageId: string
  }): Promise<SessionMeta>
  updateMeta(
    sessionId: string,
    patch: Partial<SessionMeta>,
  ): SessionMeta | undefined
}

export interface RunCommands {
  start(input: StartRunInput): void
  stop(sessionId: string): void
  isRunning(sessionId: string): boolean
}

export interface PermissionCommands {
  respond(response: PermissionResponse): void
  pending(): PermissionRequest[]
}

export interface PlanCommands {
  respond(response: PlanResponse): void
  pending(): PlanRequest[]
  setMode(sessionId: string, mode: PermissionMode): void
}

export interface AskUserCommands {
  respond(response: AskUserResponse): void
  pending(): AskUserRequest[]
}

export interface ContextCommands {
  start(sessionId: string): void
  defer(sessionId: string): void
  cancel(sessionId: string): void
}

export interface ArtifactQueries {
  list(sessionId: string): ArtifactRef[]
}

export interface CapabilityCommands {
  list(): CapabilityDescriptor[]
}

export interface SettingsCommands {
  listChannels(): Channel[]
  saveChannel(channel: Channel): void
  deleteChannel(channelId: string): void
  testChannel(channelId: string): Promise<{ success: boolean; message: string }>
}

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
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  runs: {
    start(input: StartRunInput, emit: (frame: StreamFrame) => void): Promise<void>
    stop(sessionId: string): void
    isRunning(sessionId: string): boolean
  }
  permissions: PermissionCommands & {
    expireSessionRules(sessionId: string): void
  }
  plans: PlanCommands
  questions: AskUserCommands
  context: {
    start(
      sessionId: string,
      emit: (frame: StreamFrame) => void,
      isRunning: () => boolean,
    ): Promise<void>
    defer(sessionId: string, emit: (frame: StreamFrame) => void): void
    cancel(sessionId: string, emit: (frame: StreamFrame) => void): void
    clearSession(sessionId: string): void
  }
  artifacts: ArtifactQueries
  capabilities: CapabilityCommands
  settings: SettingsCommands
  dispose?(): Promise<void>
}

/**
 * Runtime 只组合显式依赖，不读取全局状态，也不知道 Electron、pi 或存储实现。
 */
export function createAgentRuntime(
  dependencies: AgentRuntimeDependencies,
): AgentRuntime {
  const events = createAgentRuntimeEventPublisher()
  let disposed = false

  const emitHost = (
    event: HostEvent,
    sessionId = '',
    runId = 0,
  ): void => {
    events.emit({ sessionId, runId, payload: { channel: 'host', event } })
  }

  return {
    workspaces: dependencies.workspaces,
    sessions: {
      ...dependencies.sessions,
      async delete(sessionId) {
        if (dependencies.runs.isRunning(sessionId)) {
          throw new Error('任务运行中，暂时不能删除会话')
        }
        dependencies.context.clearSession(sessionId)
        await dependencies.sessions.delete(sessionId)
        dependencies.permissions.expireSessionRules(sessionId)
      },
      async truncate(sessionId, fromMessageId) {
        if (dependencies.runs.isRunning(sessionId)) {
          throw new Error('任务运行中，暂时不能编辑历史消息')
        }
        dependencies.context.clearSession(sessionId)
        return dependencies.sessions.truncate(sessionId, fromMessageId)
      },
      async clonePrefix(input) {
        if (dependencies.runs.isRunning(input.sourceSessionId)) {
          throw new Error('任务运行中，暂时不能从历史创建新会话')
        }
        return dependencies.sessions.clonePrefix(input)
      },
    },
    runs: {
      start(input) {
        void dependencies.runs.start(input, events.emit)
      },
      // Coordinator 使用私有字段维护运行注册表，不能把实例方法裸转交后再换接收者调用。
      stop: (sessionId) => dependencies.runs.stop(sessionId),
      isRunning: (sessionId) => dependencies.runs.isRunning(sessionId),
    },
    permissions: {
      respond(response) {
        dependencies.permissions.respond(response)
        emitHost({
          type: 'permission_resolved',
          requestId: response.requestId,
          allowed: response.allowed,
        })
      },
      pending: dependencies.permissions.pending,
    },
    plans: {
      respond(response) {
        dependencies.plans.respond(response)
        emitHost({
          type: 'plan_resolved',
          requestId: response.requestId,
          approved: response.approved,
        })
      },
      pending: dependencies.plans.pending,
      setMode(sessionId, mode) {
        dependencies.plans.setMode(sessionId, mode)
        dependencies.sessions.updateMeta(sessionId, { permissionMode: mode })
        emitHost({ type: 'mode_changed', mode, source: 'user' }, sessionId)
      },
    },
    questions: {
      respond(response) {
        dependencies.questions.respond(response)
        emitHost({ type: 'ask_user_resolved', requestId: response.requestId })
      },
      pending: dependencies.questions.pending,
    },
    context: {
      start(sessionId) {
        void dependencies.context.start(
          sessionId,
          events.emit,
          () => dependencies.runs.isRunning(sessionId),
        )
      },
      defer(sessionId) {
        dependencies.context.defer(sessionId, events.emit)
      },
      cancel(sessionId) {
        dependencies.context.cancel(sessionId, events.emit)
      },
    },
    artifacts: dependencies.artifacts,
    capabilities: dependencies.capabilities,
    settings: dependencies.settings,
    subscribe: events.subscribe,
    async dispose() {
      if (disposed) return
      disposed = true
      events.clear()
      await dependencies.dispose?.()
    },
  }
}
