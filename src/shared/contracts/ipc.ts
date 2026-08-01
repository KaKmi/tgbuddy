/**
 * IPC 契约 —— 通道名常量与 preload 暴露的 API 形状。
 *
 * 加一个新通道要同步改四个地方：
 *   1. 这里加常量和类型
 *   2. main/ipc.ts 注册 handler
 *   3. preload/index.ts 暴露方法
 *   4. renderer 的 atoms 里调用
 *
 * 四处不同步是这类架构最常见的 bug 来源，所以类型定义集中放这里，
 * 让 TypeScript 帮忙对齐。
 */

import type { StreamFrame } from './events.ts'
import type { SessionMessage } from './message.ts'
import type {
  Channel,
  ChannelSaveInput,
  ChannelTestResult,
} from './channel.ts'
import type { Profile, ProfileSaveInput } from './profile.ts'
import type { ToolSettingView } from './tool.ts'
import type { SkillGroupView } from './skill.ts'
import type {
  McpSaveInput,
  McpServerConfig,
  McpServerStatus,
} from './mcp.ts'
import type { StartRunInput } from './run.ts'
import type { RunRecord } from './run-snapshot.ts'
import type { AttachmentRef } from './attachment.ts'
import type { BlobRef } from './blob.ts'
import type { ArtifactPreviewResult, ArtifactRef } from './artifact.ts'
import type { SessionMeta } from './session.ts'
import type {
  Workspace,
  WorkspaceMountResolution,
} from './workspace.ts'
import type {
  AskUserRequest,
  AskUserResponse,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  PermissionRule,
  PlanRequest,
  PlanResponse,
} from './permission.ts'

// ── 通道名 ────────────────────────────────────────────────────────

export const IPC = {
  // 工作区
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_SELECT: 'workspace:select',
  WORKSPACE_CURRENT: 'workspace:current',
  WORKSPACE_MOUNT_STATUS: 'workspace:mount-status',
  /** 主进程打开系统目录选择器，只返回路径，不创建工作区 */
  WORKSPACE_PICK: 'workspace:pick',

  // 会话
  SESSION_LIST: 'session:list',
  SESSION_CREATE: 'session:create',
  SESSION_DELETE: 'session:delete',
  SESSION_MESSAGES: 'session:messages',
  SESSION_COMPACTED_MESSAGES: 'session:compacted-messages',
  SESSION_TRUNCATE: 'session:truncate',
  SESSION_CLONE_PREFIX: 'session:clone-prefix',
  SESSION_UPDATE_META: 'session:update-meta',

  // Agent 运行
  AGENT_SEND: 'agent:send',
  AGENT_STOP: 'agent:stop',
  ATTACHMENT_STAGE: 'attachment:stage',
  ATTACHMENT_DISCARD: 'attachment:discard',
  TOOL_OUTPUT_READ: 'tool-output:read',
  ARTIFACT_LIST: 'artifact:list',
  ARTIFACT_PREVIEW: 'artifact:preview',
  ARTIFACT_OPEN: 'artifact:open',
  /** 主 → 渲染，单向推送 */
  AGENT_STREAM: 'agent:stream',

  // 权限
  PERMISSION_RESPOND: 'permission:respond',
  /** 渲染进程重载后捞回挂起的请求 */
  PERMISSION_PENDING: 'permission:pending',
  PERMISSION_RULES: 'permission:rules',
  PERMISSION_RULE_REMOVE: 'permission:rule-remove',

  // 计划模式
  PLAN_RESPOND: 'plan:respond',
  PLAN_PENDING: 'plan:pending',
  MODE_SET: 'mode:set',

  // 上下文压缩
  COMPACTION_START: 'compaction:start',
  COMPACTION_DEFER: 'compaction:defer',
  COMPACTION_CANCEL: 'compaction:cancel',

  // 用户问答
  ASK_USER_RESPOND: 'ask-user:respond',
  ASK_USER_PENDING: 'ask-user:pending',

  // 渠道
  CHANNEL_LIST: 'channel:list',
  CHANNEL_SAVE: 'channel:save',
  CHANNEL_DELETE: 'channel:delete',
  CHANNEL_TEST: 'channel:test',

  // Profile
  PROFILE_LIST: 'profile:list',
  PROFILE_SAVE: 'profile:save',
  PROFILE_DELETE: 'profile:delete',

  // 工具三档权限
  TOOL_LIST: 'tool:list',

  // 技能
  SKILL_LIST: 'skill:list',
  SKILL_SET_ENABLED: 'skill:set-enabled',

  // MCP
  MCP_LIST: 'mcp:list',
  MCP_SAVE: 'mcp:save',
  MCP_DELETE: 'mcp:delete',
  MCP_CONNECT: 'mcp:connect',
  MCP_DISCONNECT: 'mcp:disconnect',
  MCP_STATUS: 'mcp:status',

  // Run 账本
  RUNS_LIST: 'runs:list',

  // 自绘标题栏
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
} as const satisfies Record<string, keyof IpcCommandMap | keyof IpcEventMap>

// ── 请求/响应类型 ─────────────────────────────────────────────────

export type {
  PermissionRequest,
  PermissionResponse,
  PermissionRule,
} from './permission.ts'
export type { SessionMeta } from './session.ts'
export type { Workspace } from './workspace.ts'
export type { WorkspaceMountResolution } from './workspace.ts'

export interface IpcCommand<Request, Response> {
  request: Request
  response: Response
}

/**
 * IPC 请求/响应唯一类型源。Electron handler 与 Preload 友好 API 都从这里取类型。
 */
export interface IpcCommandMap {
  'workspace:list': IpcCommand<undefined, Workspace[]>
  'workspace:create': IpcCommand<{ path: string }, Workspace>
  'workspace:select': IpcCommand<{ workspaceId: string }, Workspace>
  'workspace:current': IpcCommand<undefined, Workspace | undefined>
  'workspace:mount-status': IpcCommand<
    { workspaceId: string },
    WorkspaceMountResolution
  >
  'workspace:pick': IpcCommand<undefined, string | null>
  'session:list': IpcCommand<undefined, SessionMeta[]>
  'session:create': IpcCommand<
    { title?: string; channelId?: string; modelId?: string; profileId?: string },
    SessionMeta
  >
  'session:delete': IpcCommand<string, void>
  'session:messages': IpcCommand<string, SessionMessage[]>
  'session:compacted-messages': IpcCommand<
    { sessionId: string; compactionId: string },
    SessionMessage[]
  >
  'session:truncate': IpcCommand<
    { sessionId: string; fromMessageId: string },
    SessionMessage[]
  >
  'session:clone-prefix': IpcCommand<
    { sourceSessionId: string; throughMessageId: string },
    SessionMeta
  >
  'session:update-meta': IpcCommand<
    { sessionId: string; patch: Partial<SessionMeta> },
    void
  >
  'agent:send': IpcCommand<StartRunInput, void>
  'agent:stop': IpcCommand<string, void>
  'attachment:stage': IpcCommand<
    { name: string; mime?: string; bytes: Uint8Array },
    AttachmentRef
  >
  'attachment:discard': IpcCommand<AttachmentRef, void>
  'tool-output:read': IpcCommand<{ ref: BlobRef }, string>
  'artifact:list': IpcCommand<{ sessionId: string }, ArtifactRef[]>
  'artifact:preview': IpcCommand<
    { sessionId: string; artifactId: string },
    ArtifactPreviewResult
  >
  'artifact:open': IpcCommand<
    { sessionId: string; artifactId: string },
    { ok: boolean; error?: string }
  >
  'permission:respond': IpcCommand<PermissionResponse, void>
  'permission:pending': IpcCommand<undefined, PermissionRequest[]>
  'permission:rules': IpcCommand<undefined, PermissionRule[]>
  'permission:rule-remove': IpcCommand<{ id: string }, void>
  'plan:respond': IpcCommand<PlanResponse, void>
  'plan:pending': IpcCommand<undefined, PlanRequest[]>
  'mode:set': IpcCommand<{ sessionId: string; mode: PermissionMode }, void>
  'compaction:start': IpcCommand<string, void>
  'compaction:defer': IpcCommand<string, void>
  'compaction:cancel': IpcCommand<string, void>
  'ask-user:respond': IpcCommand<AskUserResponse, void>
  'ask-user:pending': IpcCommand<undefined, AskUserRequest[]>
  'channel:list': IpcCommand<undefined, Channel[]>
  'channel:save': IpcCommand<ChannelSaveInput, void>
  'channel:delete': IpcCommand<string, void>
  'channel:test': IpcCommand<string, ChannelTestResult>
  'profile:list': IpcCommand<undefined, Profile[]>
  'profile:save': IpcCommand<ProfileSaveInput, void>
  'profile:delete': IpcCommand<string, void>
  'tool:list': IpcCommand<undefined, ToolSettingView[]>
  'skill:list': IpcCommand<{ workspaceId?: string }, SkillGroupView[]>
  'skill:set-enabled': IpcCommand<{ skillId: string; enabled: boolean }, void>
  'mcp:list': IpcCommand<undefined, McpServerConfig[]>
  'mcp:save': IpcCommand<McpSaveInput, void>
  'mcp:delete': IpcCommand<string, void>
  'mcp:connect': IpcCommand<string, McpServerStatus>
  'mcp:disconnect': IpcCommand<string, void>
  'mcp:status': IpcCommand<undefined, McpServerStatus[]>
  'runs:list': IpcCommand<string, RunRecord[]>
  'window:minimize': IpcCommand<undefined, void>
  'window:toggle-maximize': IpcCommand<undefined, void>
  'window:close': IpcCommand<undefined, void>
}

export type IpcCommandName = keyof IpcCommandMap
export type IpcRequest<Name extends IpcCommandName> = IpcCommandMap[Name]['request']
export type IpcResponse<Name extends IpcCommandName> = IpcCommandMap[Name]['response']

export interface IpcEventMap {
  'agent:stream': StreamFrame
}

// ── preload 暴露给渲染进程的 API ──────────────────────────────────

export interface TgBuddyAPI {
  workspace: {
    list(): Promise<IpcResponse<'workspace:list'>>
    create(input: IpcRequest<'workspace:create'>): Promise<IpcResponse<'workspace:create'>>
    select(
      workspaceId: IpcRequest<'workspace:select'>['workspaceId'],
    ): Promise<IpcResponse<'workspace:select'>>
    current(): Promise<IpcResponse<'workspace:current'>>
    mountStatus(
      workspaceId: IpcRequest<'workspace:mount-status'>['workspaceId'],
    ): Promise<IpcResponse<'workspace:mount-status'>>
    pick(): Promise<IpcResponse<'workspace:pick'>>
  }
  session: {
    list(): Promise<IpcResponse<'session:list'>>
    create(input: IpcRequest<'session:create'>): Promise<IpcResponse<'session:create'>>
    delete(id: IpcRequest<'session:delete'>): Promise<IpcResponse<'session:delete'>>
    messages(id: IpcRequest<'session:messages'>): Promise<IpcResponse<'session:messages'>>
    compactedMessages(
      id: IpcRequest<'session:compacted-messages'>['sessionId'],
      compactionId: IpcRequest<'session:compacted-messages'>['compactionId'],
    ): Promise<IpcResponse<'session:compacted-messages'>>
    truncate(
      id: IpcRequest<'session:truncate'>['sessionId'],
      fromMessageId: IpcRequest<'session:truncate'>['fromMessageId'],
    ): Promise<IpcResponse<'session:truncate'>>
    clonePrefix(
      sourceSessionId: IpcRequest<'session:clone-prefix'>['sourceSessionId'],
      throughMessageId: IpcRequest<'session:clone-prefix'>['throughMessageId'],
    ): Promise<IpcResponse<'session:clone-prefix'>>
    updateMeta(
      id: IpcRequest<'session:update-meta'>['sessionId'],
      patch: IpcRequest<'session:update-meta'>['patch'],
    ): Promise<IpcResponse<'session:update-meta'>>
  }
  agent: {
    send(input: IpcRequest<'agent:send'>): Promise<IpcResponse<'agent:send'>> 
    stop(sessionId: IpcRequest<'agent:stop'>): Promise<IpcResponse<'agent:stop'>>
    /** 订阅流式帧，返回取消订阅函数 */
    onStream(listener: (frame: IpcEventMap['agent:stream']) => void): () => void
  }
  attachment: {
    stage(input: IpcRequest<'attachment:stage'>): Promise<IpcResponse<'attachment:stage'>>
    discard(ref: IpcRequest<'attachment:discard'>): Promise<IpcResponse<'attachment:discard'>>
  }
  toolOutput: {
    read(ref: IpcRequest<'tool-output:read'>['ref']): Promise<IpcResponse<'tool-output:read'>>
  }
  artifact: {
    list(sessionId: IpcRequest<'artifact:list'>['sessionId']): Promise<IpcResponse<'artifact:list'>>
    preview(input: IpcRequest<'artifact:preview'>): Promise<IpcResponse<'artifact:preview'>>
    open(input: IpcRequest<'artifact:open'>): Promise<IpcResponse<'artifact:open'>>
  }
  permission: {
    respond(res: IpcRequest<'permission:respond'>): Promise<IpcResponse<'permission:respond'>>
    pending(): Promise<IpcResponse<'permission:pending'>>
    rules(): Promise<IpcResponse<'permission:rules'>>
    removeRule(id: IpcRequest<'permission:rule-remove'>['id']): Promise<IpcResponse<'permission:rule-remove'>>
  }
  plan: {
    respond(res: IpcRequest<'plan:respond'>): Promise<IpcResponse<'plan:respond'>>
    pending(): Promise<IpcResponse<'plan:pending'>>
    /** 用户手动切换权限模式 */
    setMode(
      sessionId: IpcRequest<'mode:set'>['sessionId'],
      mode: IpcRequest<'mode:set'>['mode'],
    ): Promise<IpcResponse<'mode:set'>>
  }
  askUser: {
    respond(res: IpcRequest<'ask-user:respond'>): Promise<IpcResponse<'ask-user:respond'>>
    pending(): Promise<IpcResponse<'ask-user:pending'>>
  }
  compaction: {
    start(
      sessionId: IpcRequest<'compaction:start'>,
    ): Promise<IpcResponse<'compaction:start'>>
    defer(
      sessionId: IpcRequest<'compaction:defer'>,
    ): Promise<IpcResponse<'compaction:defer'>>
    cancel(
      sessionId: IpcRequest<'compaction:cancel'>,
    ): Promise<IpcResponse<'compaction:cancel'>>
  }
  channel: {
    list(): Promise<IpcResponse<'channel:list'>>
    save(channel: IpcRequest<'channel:save'>): Promise<IpcResponse<'channel:save'>>
    delete(id: IpcRequest<'channel:delete'>): Promise<IpcResponse<'channel:delete'>>
    test(id: IpcRequest<'channel:test'>): Promise<IpcResponse<'channel:test'>>
  }
  profile: {
    list(): Promise<IpcResponse<'profile:list'>>
    save(profile: IpcRequest<'profile:save'>): Promise<IpcResponse<'profile:save'>>
    delete(id: IpcRequest<'profile:delete'>): Promise<IpcResponse<'profile:delete'>>
  }
  tool: {
    list(): Promise<IpcResponse<'tool:list'>>
  }
  skill: {
    list(
      workspaceId?: IpcRequest<'skill:list'>['workspaceId'],
    ): Promise<IpcResponse<'skill:list'>>
    setEnabled(
      skillId: IpcRequest<'skill:set-enabled'>['skillId'],
      enabled: IpcRequest<'skill:set-enabled'>['enabled'],
    ): Promise<IpcResponse<'skill:set-enabled'>>
  }
  mcp: {
    list(): Promise<IpcResponse<'mcp:list'>>
    save(config: IpcRequest<'mcp:save'>): Promise<IpcResponse<'mcp:save'>>
    delete(id: IpcRequest<'mcp:delete'>): Promise<IpcResponse<'mcp:delete'>>
    connect(id: IpcRequest<'mcp:connect'>): Promise<IpcResponse<'mcp:connect'>>
    disconnect(
      id: IpcRequest<'mcp:disconnect'>,
    ): Promise<IpcResponse<'mcp:disconnect'>>
    status(): Promise<IpcResponse<'mcp:status'>>
  }
  runs: {
    list(
      sessionId: IpcRequest<'runs:list'>,
    ): Promise<IpcResponse<'runs:list'>>
  }
  windowControls: {
    minimize(): Promise<IpcResponse<'window:minimize'>>
    toggleMaximize(): Promise<IpcResponse<'window:toggle-maximize'>>
    close(): Promise<IpcResponse<'window:close'>>
  }
}

declare global {
  interface Window {
    tgbuddy: TgBuddyAPI
  }
}
