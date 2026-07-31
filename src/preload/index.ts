/**
 * Preload —— IPC 上下文桥接。
 *
 * 加一个新通道要同步改四处（见 shared/ipc.ts）：这里是第三处。
 *
 * ⚠️ 这个文件编译成 CJS（`dist/preload.cjs`）。Electron 的 preload 在
 *    sandbox 关闭时才支持 ESM，我们不冒这个险 —— preload 只用 electron 的
 *    两个 API，没有 ESM 依赖，CJS 完全够用。
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TgBuddyAPI } from '../shared/contracts/ipc.ts'
import type { StreamFrame } from '../shared/contracts/events.ts'

const api = {
  workspace: {
    list: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
    create: (input) => ipcRenderer.invoke(IPC.WORKSPACE_CREATE, input),
    select: (workspaceId) =>
      ipcRenderer.invoke(IPC.WORKSPACE_SELECT, { workspaceId }),
    current: () => ipcRenderer.invoke(IPC.WORKSPACE_CURRENT),
    mountStatus: (workspaceId) =>
      ipcRenderer.invoke(IPC.WORKSPACE_MOUNT_STATUS, { workspaceId }),
    pick: () => ipcRenderer.invoke(IPC.WORKSPACE_PICK),
  },
  session: {
    list: () => ipcRenderer.invoke(IPC.SESSION_LIST),
    create: (input) => ipcRenderer.invoke(IPC.SESSION_CREATE, input),
    delete: (id) => ipcRenderer.invoke(IPC.SESSION_DELETE, id),
    messages: (id) => ipcRenderer.invoke(IPC.SESSION_MESSAGES, id),
    compactedMessages: (id, compactionId) =>
      ipcRenderer.invoke(IPC.SESSION_COMPACTED_MESSAGES, {
        sessionId: id,
        compactionId,
      }),
    truncate: (id, fromMessageId) =>
      ipcRenderer.invoke(IPC.SESSION_TRUNCATE, {
        sessionId: id,
        fromMessageId,
      }),
    clonePrefix: (sourceSessionId, throughMessageId) =>
      ipcRenderer.invoke(IPC.SESSION_CLONE_PREFIX, {
        sourceSessionId,
        throughMessageId,
      }),
    updateMeta: (id, patch) =>
      ipcRenderer.invoke(IPC.SESSION_UPDATE_META, { sessionId: id, patch }),
  },
  agent: {
    send: (input) => ipcRenderer.invoke(IPC.AGENT_SEND, input),
    stop: (sessionId) => ipcRenderer.invoke(IPC.AGENT_STOP, sessionId),
    onStream: (listener) => {
      const handler = (_e: IpcRendererEvent, frame: StreamFrame): void => listener(frame)
      ipcRenderer.on(IPC.AGENT_STREAM, handler)
      return () => ipcRenderer.off(IPC.AGENT_STREAM, handler)
    },
  },
  permission: {
    respond: (res) => ipcRenderer.invoke(IPC.PERMISSION_RESPOND, res),
    pending: () => ipcRenderer.invoke(IPC.PERMISSION_PENDING),
    rules: () => ipcRenderer.invoke(IPC.PERMISSION_RULES),
    removeRule: (id) => ipcRenderer.invoke(IPC.PERMISSION_RULE_REMOVE, { id }),
  },
  plan: {
    respond: (res) => ipcRenderer.invoke(IPC.PLAN_RESPOND, res),
    pending: () => ipcRenderer.invoke(IPC.PLAN_PENDING),
    setMode: (sessionId, mode) => ipcRenderer.invoke(IPC.MODE_SET, { sessionId, mode }),
  },
  askUser: {
    respond: (res) => ipcRenderer.invoke(IPC.ASK_USER_RESPOND, res),
    pending: () => ipcRenderer.invoke(IPC.ASK_USER_PENDING),
  },
  compaction: {
    start: (sessionId) => ipcRenderer.invoke(IPC.COMPACTION_START, sessionId),
    defer: (sessionId) => ipcRenderer.invoke(IPC.COMPACTION_DEFER, sessionId),
    cancel: (sessionId) => ipcRenderer.invoke(IPC.COMPACTION_CANCEL, sessionId),
  },
  channel: {
    list: () => ipcRenderer.invoke(IPC.CHANNEL_LIST),
    save: (channel) => ipcRenderer.invoke(IPC.CHANNEL_SAVE, channel),
    delete: (id) => ipcRenderer.invoke(IPC.CHANNEL_DELETE, id),
    test: (id) => ipcRenderer.invoke(IPC.CHANNEL_TEST, id),
  },
  profile: {
    list: () => ipcRenderer.invoke(IPC.PROFILE_LIST),
    save: (profile) => ipcRenderer.invoke(IPC.PROFILE_SAVE, profile),
    delete: (id) => ipcRenderer.invoke(IPC.PROFILE_DELETE, id),
  },
  tool: {
    list: () => ipcRenderer.invoke(IPC.TOOL_LIST),
    setPermission: (toolId, permission) =>
      ipcRenderer.invoke(IPC.TOOL_PERMISSION_SET, { toolId, permission }),
    resetPermission: (toolId) =>
      ipcRenderer.invoke(IPC.TOOL_PERMISSION_RESET, { toolId }),
    resetAll: () => ipcRenderer.invoke(IPC.TOOL_PERMISSIONS_RESET),
    bulkAsk: (toolIds) => ipcRenderer.invoke(IPC.TOOL_BULK_ASK, { toolIds }),
  },
  skill: {
    list: (workspaceId) => ipcRenderer.invoke(IPC.SKILL_LIST, { workspaceId }),
    setEnabled: (skillId, enabled) =>
      ipcRenderer.invoke(IPC.SKILL_SET_ENABLED, { skillId, enabled }),
  },
  mcp: {
    list: () => ipcRenderer.invoke(IPC.MCP_LIST),
    save: (config) => ipcRenderer.invoke(IPC.MCP_SAVE, config),
    delete: (id) => ipcRenderer.invoke(IPC.MCP_DELETE, id),
    connect: (id) => ipcRenderer.invoke(IPC.MCP_CONNECT, id),
    disconnect: (id) => ipcRenderer.invoke(IPC.MCP_DISCONNECT, id),
    status: () => ipcRenderer.invoke(IPC.MCP_STATUS),
  },
  runs: {
    list: (sessionId) => ipcRenderer.invoke(IPC.RUNS_LIST, sessionId),
  },
} satisfies TgBuddyAPI

contextBridge.exposeInMainWorld('tgbuddy', api)
