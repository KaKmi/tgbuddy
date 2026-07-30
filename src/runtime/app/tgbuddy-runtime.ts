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
import type { SendInput } from '../../shared/contracts/ipc.ts'
import type { SessionMessage } from '../../shared/contracts/message.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type { Workspace } from '../../shared/contracts/workspace.ts'
import {
  createRuntimeEventPublisher,
  type RuntimeEventListener,
} from './runtime-events.ts'

export interface WorkspaceCommands {
  list(): Workspace[]
}

export interface SessionCommands {
  list(): SessionMeta[]
  create(input: { title?: string; channelId?: string; modelId?: string }): SessionMeta
  delete(sessionId: string): void
  messages(sessionId: string): SessionMessage[]
  compactedMessages(sessionId: string, compactionId: string): SessionMessage[]
  updateMeta(sessionId: string, patch: Partial<SessionMeta>): void
}

export interface RunCommands {
  send(input: SendInput): void
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

export interface TgBuddyRuntime {
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
  subscribe(listener: RuntimeEventListener): () => void
  dispose(): Promise<void>
}

export interface RuntimeDependencies {
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  runs: {
    send(input: SendInput, emit: (frame: StreamFrame) => void): Promise<void>
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
export function createTgBuddyRuntime(dependencies: RuntimeDependencies): TgBuddyRuntime {
  const events = createRuntimeEventPublisher()
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
      delete(sessionId) {
        dependencies.context.clearSession(sessionId)
        dependencies.sessions.delete(sessionId)
        dependencies.permissions.expireSessionRules(sessionId)
      },
    },
    runs: {
      send(input) {
        void dependencies.runs.send(input, events.emit)
      },
      stop: dependencies.runs.stop,
      isRunning: dependencies.runs.isRunning,
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
