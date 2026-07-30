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
} satisfies TgBuddyAPI

contextBridge.exposeInMainWorld('tgbuddy', api)
