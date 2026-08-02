import type { ArtifactRef } from '../../shared/contracts/artifact.ts'
import type { CapabilityDescriptor } from '../../shared/contracts/capability.ts'
import type {
  Channel,
  ChannelTestResult,
  ChannelSaveInput,
} from '../../shared/contracts/channel.ts'
import type { Profile, ProfileSaveInput } from '../../shared/contracts/profile.ts'
import type { ToolSettingView } from '../../shared/contracts/tool.ts'
import type { SkillGroupView } from '../../shared/contracts/skill.ts'
import type {
  McpSaveInput,
  McpServerConfig,
  McpServerStatus,
} from '../../shared/contracts/mcp.ts'
import type { RunRecord } from '../runs/run-repository.ts'
import type { HostEvent, StreamFrame } from '../../shared/contracts/events.ts'
import type {
  AskUserRequest,
  AskUserResponse,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  PermissionRule,
  PlanRequest,
  PlanResponse,
} from '../../shared/contracts/permission.ts'
import type { SessionMessage } from '../../shared/contracts/message.ts'
import type { StartRunInput } from '../../shared/contracts/run.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type { HumanInteractionRequest } from '../../shared/contracts/interaction.ts'
import type { DelegationTask } from '../../shared/contracts/delegation.ts'
import type { SessionTitleService } from '../sessions/session-title-service.ts'
import type {
  Workspace,
  WorkspaceMountResolution,
} from '../../shared/contracts/workspace.ts'
import {
  createAgentRuntimeEventPublisher,
  type AgentRuntimeEventListener,
} from './agent-runtime-events.ts'

export interface WorkspaceCommands {
  list(): Workspace[]
  create(input: { path: string }): Workspace
  select(workspaceId: string): Workspace
  current(): Workspace | undefined
  mountStatus(workspaceId: string): WorkspaceMountResolution
}

export interface SessionCommands {
  list(): SessionMeta[]
  get(sessionId: string): SessionMeta | undefined
  create(input: {
    title?: string
    channelId?: string
    modelId?: string
    profileId?: string
    visibility?: SessionMeta['visibility']
    parentTaskId?: string
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
  /** C12：会话的 Run 账本（能力快照 + token/cost） */
  list(sessionId: string): RunRecord[]
}

export interface PermissionCommands {
  respond(response: PermissionResponse): Promise<void>
  pending(): PermissionRequest[]
  listRules(): PermissionRule[]
  removeRule(id: string): void
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

export interface InteractionCommands {
  pending(rootRunId?: string): HumanInteractionRequest[]
  respond(input: { requestId: string; response: unknown; expectedRevision: number }): Promise<void>
}

export interface DelegationCommands {
  list(rootRunId: string): DelegationTask[]
  listSession(rootSessionId: string): DelegationTask[]
  messages(taskId: string): Promise<SessionMessage[]>
  stop(taskId: string): Promise<void>
  retry(taskId: string): Promise<DelegationTask>
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
  saveChannel(channel: ChannelSaveInput): void
  deleteChannel(channelId: string): void
  testChannel(channelId: string): Promise<ChannelTestResult>
  listProfiles(): Profile[]
  saveProfile(profile: ProfileSaveInput): void
  deleteProfile(profileId: string): void
  /** 工具只读展示（权限由内置分类派生，配置入口在权限模式与「总是允许」规则） */
  listTools(): ToolSettingView[]
  /** C07：技能目录（按来源分组），workspaceId 切换即刷新 */
  listSkills(workspaceId?: string): SkillGroupView[]
  setSkillEnabled(skillId: string, enabled: boolean): void
  /** C09：MCP 服务配置、连接状态与错误 */
  listMcpServers(): McpServerConfig[]
  saveMcpServer(config: McpSaveInput): void
  deleteMcpServer(serverId: string): void
  connectMcp(serverId: string): Promise<McpServerStatus>
  disconnectMcp(serverId: string): Promise<void>
  mcpStatuses(): McpServerStatus[]
}

export interface AgentRuntime {
  workspaces: WorkspaceCommands
  sessions: SessionCommands
  runs: RunCommands
  permissions: PermissionCommands
  plans: PlanCommands
  questions: AskUserCommands
  interactions: InteractionCommands
  delegations: DelegationCommands
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
  sessionTitles?: SessionTitleService
  runs: {
    start(input: StartRunInput, emit: (frame: StreamFrame) => void): Promise<void>
    stop(sessionId: string): void
    isRunning(sessionId: string): boolean
    list?(sessionId: string): RunRecord[]
  }
  permissions: PermissionCommands & {
    expireSessionRules(sessionId: string): void
  }
  plans: PlanCommands
  questions: AskUserCommands
  interactions: InteractionCommands
  delegations: DelegationCommands
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
      updateMeta(sessionId, patch) {
        return dependencies.sessions.updateMeta(
          sessionId,
          patch.title !== undefined && patch.titleSource === undefined
            ? { ...patch, titleSource: 'user' }
            : patch,
        )
      },
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
        let titleRequested = false
        void dependencies.runs.start(input, (frame) => {
          events.emit(frame)
          if (
            !titleRequested
            && !input.lineage
            && frame.payload.channel === 'agent'
            && frame.payload.event.type === 'run_start'
          ) {
            titleRequested = true
            void dependencies.sessionTitles?.request({
              sessionId: input.sessionId,
              userMessage: input.text,
            })
          }
        })
      },
      // Coordinator 使用私有字段维护运行注册表，不能把实例方法裸转交后再换接收者调用。
      stop: (sessionId) => dependencies.runs.stop(sessionId),
      isRunning: (sessionId) => dependencies.runs.isRunning(sessionId),
      list: (sessionId) => dependencies.runs.list?.(sessionId) ?? [],
    },
    permissions: {
      async respond(response) {
        await dependencies.permissions.respond(response)
        emitHost({
          type: 'permission_resolved',
          requestId: response.requestId,
          allowed: response.allowed,
        })
      },
      pending: dependencies.permissions.pending,
      listRules: dependencies.permissions.listRules,
      removeRule: dependencies.permissions.removeRule,
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
    interactions: dependencies.interactions,
    delegations: dependencies.delegations,
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
