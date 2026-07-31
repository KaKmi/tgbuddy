/**
 * Electron IPC adapter。
 *
 * handler 只接收输入、调用 Runtime 公共门面并返回 contract；
 * 具体 service、repository 和 kernel 只能由 Composition Root 装配。
 */

import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { AgentRuntime } from '../runtime/index.ts'
import {
  IPC,
  type IpcRequest,
  type IpcResponse,
} from '../shared/contracts/ipc.ts'

export function registerIpc(
  agentRuntime: AgentRuntime,
  getWindow: () => BrowserWindow | null,
): () => void {
  const unsubscribe = agentRuntime.subscribe((frame) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC.AGENT_STREAM, frame)
  })

  ipcMain.handle(
    IPC.WORKSPACE_LIST,
    (): IpcResponse<'workspace:list'> => agentRuntime.workspaces.list(),
  )
  ipcMain.handle(
    IPC.WORKSPACE_CREATE,
    (
      _event,
      input: IpcRequest<'workspace:create'>,
    ): IpcResponse<'workspace:create'> => agentRuntime.workspaces.create(input),
  )
  ipcMain.handle(
    IPC.WORKSPACE_SELECT,
    (
      _event,
      input: IpcRequest<'workspace:select'>,
    ): IpcResponse<'workspace:select'> =>
      agentRuntime.workspaces.select(input.workspaceId),
  )
  ipcMain.handle(
    IPC.WORKSPACE_CURRENT,
    (): IpcResponse<'workspace:current'> => agentRuntime.workspaces.current(),
  )
  ipcMain.handle(
    IPC.WORKSPACE_MOUNT_STATUS,
    (
      _event,
      input: IpcRequest<'workspace:mount-status'>,
    ): IpcResponse<'workspace:mount-status'> =>
      agentRuntime.workspaces.mountStatus(input.workspaceId),
  )
  ipcMain.handle(
    IPC.WORKSPACE_PICK,
    async (): Promise<IpcResponse<'workspace:pick'>> => {
      const win = getWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  )

  ipcMain.handle(
    IPC.SESSION_LIST,
    (): IpcResponse<'session:list'> => agentRuntime.sessions.list(),
  )
  ipcMain.handle(
    IPC.SESSION_CREATE,
    (
      _event,
      input: IpcRequest<'session:create'>,
    ): Promise<IpcResponse<'session:create'>> => agentRuntime.sessions.create(input ?? {}),
  )
  ipcMain.handle(
    IPC.SESSION_DELETE,
    (_event, sessionId: IpcRequest<'session:delete'>): Promise<IpcResponse<'session:delete'>> =>
      agentRuntime.sessions.delete(sessionId),
  )
  ipcMain.handle(
    IPC.SESSION_MESSAGES,
    (_event, sessionId: IpcRequest<'session:messages'>): Promise<IpcResponse<'session:messages'>> =>
      agentRuntime.sessions.messages(sessionId),
  )
  ipcMain.handle(
    IPC.SESSION_COMPACTED_MESSAGES,
    (
      _event,
      input: IpcRequest<'session:compacted-messages'>,
    ): Promise<IpcResponse<'session:compacted-messages'>> =>
      agentRuntime.sessions.compactedMessages(input.sessionId, input.compactionId),
  )
  ipcMain.handle(
    IPC.SESSION_TRUNCATE,
    (
      _event,
      input: IpcRequest<'session:truncate'>,
    ): Promise<IpcResponse<'session:truncate'>> =>
      agentRuntime.sessions.truncate(input.sessionId, input.fromMessageId),
  )
  ipcMain.handle(
    IPC.SESSION_CLONE_PREFIX,
    (
      _event,
      input: IpcRequest<'session:clone-prefix'>,
    ): Promise<IpcResponse<'session:clone-prefix'>> =>
      agentRuntime.sessions.clonePrefix(input),
  )
  ipcMain.handle(
    IPC.SESSION_UPDATE_META,
    (
      _event,
      input: IpcRequest<'session:update-meta'>,
    ): IpcResponse<'session:update-meta'> => {
      agentRuntime.sessions.updateMeta(input.sessionId, input.patch)
    },
  )

  ipcMain.handle(
    IPC.AGENT_SEND,
    (_event, input: IpcRequest<'agent:send'>): IpcResponse<'agent:send'> =>
      agentRuntime.runs.start(input),
  )
  ipcMain.handle(
    IPC.AGENT_STOP,
    (_event, sessionId: IpcRequest<'agent:stop'>): IpcResponse<'agent:stop'> =>
      agentRuntime.runs.stop(sessionId),
  )

  ipcMain.handle(
    IPC.PERMISSION_RESPOND,
    (
      _event,
      response: IpcRequest<'permission:respond'>,
    ): IpcResponse<'permission:respond'> => agentRuntime.permissions.respond(response),
  )
  ipcMain.handle(
    IPC.PERMISSION_PENDING,
    (): IpcResponse<'permission:pending'> => agentRuntime.permissions.pending(),
  )
  ipcMain.handle(
    IPC.PERMISSION_RULES,
    (): IpcResponse<'permission:rules'> => agentRuntime.permissions.listRules(),
  )
  ipcMain.handle(
    IPC.PERMISSION_RULE_REMOVE,
    (
      _event,
      input: IpcRequest<'permission:rule-remove'>,
    ): IpcResponse<'permission:rule-remove'> =>
      agentRuntime.permissions.removeRule(input.id),
  )

  ipcMain.handle(
    IPC.PLAN_RESPOND,
    (_event, response: IpcRequest<'plan:respond'>): IpcResponse<'plan:respond'> =>
      agentRuntime.plans.respond(response),
  )
  ipcMain.handle(
    IPC.PLAN_PENDING,
    (): IpcResponse<'plan:pending'> => agentRuntime.plans.pending(),
  )
  ipcMain.handle(
    IPC.MODE_SET,
    (
      _event,
      input: IpcRequest<'mode:set'>,
    ): IpcResponse<'mode:set'> => agentRuntime.plans.setMode(input.sessionId, input.mode),
  )

  ipcMain.handle(
    IPC.ASK_USER_RESPOND,
    (
      _event,
      response: IpcRequest<'ask-user:respond'>,
    ): IpcResponse<'ask-user:respond'> => agentRuntime.questions.respond(response),
  )
  ipcMain.handle(
    IPC.ASK_USER_PENDING,
    (): IpcResponse<'ask-user:pending'> => agentRuntime.questions.pending(),
  )

  ipcMain.handle(
    IPC.COMPACTION_START,
    (
      _event,
      sessionId: IpcRequest<'compaction:start'>,
    ): IpcResponse<'compaction:start'> => agentRuntime.context.start(sessionId),
  )
  ipcMain.handle(
    IPC.COMPACTION_DEFER,
    (
      _event,
      sessionId: IpcRequest<'compaction:defer'>,
    ): IpcResponse<'compaction:defer'> => agentRuntime.context.defer(sessionId),
  )
  ipcMain.handle(
    IPC.COMPACTION_CANCEL,
    (
      _event,
      sessionId: IpcRequest<'compaction:cancel'>,
    ): IpcResponse<'compaction:cancel'> => agentRuntime.context.cancel(sessionId),
  )

  ipcMain.handle(
    IPC.CHANNEL_LIST,
    (): IpcResponse<'channel:list'> => agentRuntime.settings.listChannels(),
  )
  ipcMain.handle(
    IPC.CHANNEL_SAVE,
    (_event, channel: IpcRequest<'channel:save'>): IpcResponse<'channel:save'> =>
      agentRuntime.settings.saveChannel(channel),
  )
  ipcMain.handle(
    IPC.CHANNEL_DELETE,
    (_event, channelId: IpcRequest<'channel:delete'>): IpcResponse<'channel:delete'> =>
      agentRuntime.settings.deleteChannel(channelId),
  )
  ipcMain.handle(
    IPC.CHANNEL_TEST,
    (
      _event,
      channelId: IpcRequest<'channel:test'>,
    ): Promise<IpcResponse<'channel:test'>> => agentRuntime.settings.testChannel(channelId),
  )

  ipcMain.handle(
    IPC.PROFILE_LIST,
    (): IpcResponse<'profile:list'> => agentRuntime.settings.listProfiles(),
  )
  ipcMain.handle(
    IPC.PROFILE_SAVE,
    (_event, profile: IpcRequest<'profile:save'>): IpcResponse<'profile:save'> =>
      agentRuntime.settings.saveProfile(profile),
  )
  ipcMain.handle(
    IPC.PROFILE_DELETE,
    (
      _event,
      profileId: IpcRequest<'profile:delete'>,
    ): IpcResponse<'profile:delete'> => agentRuntime.settings.deleteProfile(profileId),
  )

  ipcMain.handle(
    IPC.TOOL_LIST,
    (): IpcResponse<'tool:list'> => agentRuntime.settings.listTools(),
  )
  ipcMain.handle(
    IPC.TOOL_PERMISSION_SET,
    (
      _event,
      input: IpcRequest<'tool:permission-set'>,
    ): IpcResponse<'tool:permission-set'> =>
      agentRuntime.settings.setToolPermission(input.toolId, input.permission),
  )
  ipcMain.handle(
    IPC.TOOL_PERMISSION_RESET,
    (
      _event,
      input: IpcRequest<'tool:permission-reset'>,
    ): IpcResponse<'tool:permission-reset'> =>
      agentRuntime.settings.resetToolPermission(input.toolId),
  )
  ipcMain.handle(
    IPC.TOOL_PERMISSIONS_RESET,
    (): IpcResponse<'tool:permissions-reset'> =>
      agentRuntime.settings.resetAllToolPermissions(),
  )
  ipcMain.handle(
    IPC.TOOL_BULK_ASK,
    (
      _event,
      input: IpcRequest<'tool:bulk-ask'>,
    ): IpcResponse<'tool:bulk-ask'> =>
      agentRuntime.settings.bulkSetAskTools(input.toolIds),
  )

  ipcMain.handle(
    IPC.SKILL_LIST,
    (
      _event,
      input: IpcRequest<'skill:list'>,
    ): IpcResponse<'skill:list'> =>
      agentRuntime.settings.listSkills(input.workspaceId),
  )
  ipcMain.handle(
    IPC.SKILL_SET_ENABLED,
    (
      _event,
      input: IpcRequest<'skill:set-enabled'>,
    ): IpcResponse<'skill:set-enabled'> =>
      agentRuntime.settings.setSkillEnabled(input.skillId, input.enabled),
  )

  ipcMain.handle(
    IPC.MCP_LIST,
    (): IpcResponse<'mcp:list'> => agentRuntime.settings.listMcpServers(),
  )
  ipcMain.handle(
    IPC.MCP_SAVE,
    (_event, config: IpcRequest<'mcp:save'>): IpcResponse<'mcp:save'> =>
      agentRuntime.settings.saveMcpServer(config),
  )
  ipcMain.handle(
    IPC.MCP_DELETE,
    (_event, serverId: IpcRequest<'mcp:delete'>): IpcResponse<'mcp:delete'> =>
      agentRuntime.settings.deleteMcpServer(serverId),
  )
  ipcMain.handle(
    IPC.MCP_CONNECT,
    (
      _event,
      serverId: IpcRequest<'mcp:connect'>,
    ): Promise<IpcResponse<'mcp:connect'>> =>
      agentRuntime.settings.connectMcp(serverId),
  )
  ipcMain.handle(
    IPC.MCP_DISCONNECT,
    (
      _event,
      serverId: IpcRequest<'mcp:disconnect'>,
    ): Promise<IpcResponse<'mcp:disconnect'>> =>
      agentRuntime.settings.disconnectMcp(serverId),
  )
  ipcMain.handle(
    IPC.MCP_STATUS,
    (): IpcResponse<'mcp:status'> => agentRuntime.settings.mcpStatuses(),
  )

  ipcMain.handle(
    IPC.RUNS_LIST,
    (
      _event,
      sessionId: IpcRequest<'runs:list'>,
    ): IpcResponse<'runs:list'> => agentRuntime.runs.list(sessionId),
  )

  return unsubscribe
}
