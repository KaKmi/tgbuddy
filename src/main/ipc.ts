/**
 * Electron IPC adapter。
 *
 * handler 只接收输入、调用 Runtime 公共门面并返回 contract；
 * 具体 service、repository 和 kernel 只能由 Composition Root 装配。
 */

import { ipcMain, type BrowserWindow } from 'electron'
import type { TgBuddyRuntime } from '../runtime/index.ts'
import {
  IPC,
  type IpcRequest,
  type IpcResponse,
} from '../shared/contracts/ipc.ts'

export function registerIpc(
  runtime: TgBuddyRuntime,
  getWindow: () => BrowserWindow | null,
): () => void {
  const unsubscribe = runtime.subscribe((frame) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC.AGENT_STREAM, frame)
  })

  ipcMain.handle(
    IPC.SESSION_LIST,
    (): IpcResponse<'session:list'> => runtime.sessions.list(),
  )
  ipcMain.handle(
    IPC.SESSION_CREATE,
    (
      _event,
      input: IpcRequest<'session:create'>,
    ): Promise<IpcResponse<'session:create'>> => runtime.sessions.create(input ?? {}),
  )
  ipcMain.handle(
    IPC.SESSION_DELETE,
    (_event, sessionId: IpcRequest<'session:delete'>): Promise<IpcResponse<'session:delete'>> =>
      runtime.sessions.delete(sessionId),
  )
  ipcMain.handle(
    IPC.SESSION_MESSAGES,
    (_event, sessionId: IpcRequest<'session:messages'>): Promise<IpcResponse<'session:messages'>> =>
      runtime.sessions.messages(sessionId),
  )
  ipcMain.handle(
    IPC.SESSION_COMPACTED_MESSAGES,
    (
      _event,
      input: IpcRequest<'session:compacted-messages'>,
    ): Promise<IpcResponse<'session:compacted-messages'>> =>
      runtime.sessions.compactedMessages(input.sessionId, input.compactionId),
  )
  ipcMain.handle(
    IPC.SESSION_TRUNCATE,
    (
      _event,
      input: IpcRequest<'session:truncate'>,
    ): Promise<IpcResponse<'session:truncate'>> =>
      runtime.sessions.truncate(input.sessionId, input.fromMessageId),
  )
  ipcMain.handle(
    IPC.SESSION_UPDATE_META,
    (
      _event,
      input: IpcRequest<'session:update-meta'>,
    ): IpcResponse<'session:update-meta'> => {
      runtime.sessions.updateMeta(input.sessionId, input.patch)
    },
  )

  ipcMain.handle(
    IPC.AGENT_SEND,
    (_event, input: IpcRequest<'agent:send'>): IpcResponse<'agent:send'> =>
      runtime.runs.send(input),
  )
  ipcMain.handle(
    IPC.AGENT_STOP,
    (_event, sessionId: IpcRequest<'agent:stop'>): IpcResponse<'agent:stop'> =>
      runtime.runs.stop(sessionId),
  )

  ipcMain.handle(
    IPC.PERMISSION_RESPOND,
    (
      _event,
      response: IpcRequest<'permission:respond'>,
    ): IpcResponse<'permission:respond'> => runtime.permissions.respond(response),
  )
  ipcMain.handle(
    IPC.PERMISSION_PENDING,
    (): IpcResponse<'permission:pending'> => runtime.permissions.pending(),
  )

  ipcMain.handle(
    IPC.PLAN_RESPOND,
    (_event, response: IpcRequest<'plan:respond'>): IpcResponse<'plan:respond'> =>
      runtime.plans.respond(response),
  )
  ipcMain.handle(
    IPC.PLAN_PENDING,
    (): IpcResponse<'plan:pending'> => runtime.plans.pending(),
  )
  ipcMain.handle(
    IPC.MODE_SET,
    (
      _event,
      input: IpcRequest<'mode:set'>,
    ): IpcResponse<'mode:set'> => runtime.plans.setMode(input.sessionId, input.mode),
  )

  ipcMain.handle(
    IPC.ASK_USER_RESPOND,
    (
      _event,
      response: IpcRequest<'ask-user:respond'>,
    ): IpcResponse<'ask-user:respond'> => runtime.questions.respond(response),
  )
  ipcMain.handle(
    IPC.ASK_USER_PENDING,
    (): IpcResponse<'ask-user:pending'> => runtime.questions.pending(),
  )

  ipcMain.handle(
    IPC.COMPACTION_START,
    (
      _event,
      sessionId: IpcRequest<'compaction:start'>,
    ): IpcResponse<'compaction:start'> => runtime.context.start(sessionId),
  )
  ipcMain.handle(
    IPC.COMPACTION_DEFER,
    (
      _event,
      sessionId: IpcRequest<'compaction:defer'>,
    ): IpcResponse<'compaction:defer'> => runtime.context.defer(sessionId),
  )
  ipcMain.handle(
    IPC.COMPACTION_CANCEL,
    (
      _event,
      sessionId: IpcRequest<'compaction:cancel'>,
    ): IpcResponse<'compaction:cancel'> => runtime.context.cancel(sessionId),
  )

  ipcMain.handle(
    IPC.CHANNEL_LIST,
    (): IpcResponse<'channel:list'> => runtime.settings.listChannels(),
  )
  ipcMain.handle(
    IPC.CHANNEL_SAVE,
    (_event, channel: IpcRequest<'channel:save'>): IpcResponse<'channel:save'> =>
      runtime.settings.saveChannel(channel),
  )
  ipcMain.handle(
    IPC.CHANNEL_DELETE,
    (_event, channelId: IpcRequest<'channel:delete'>): IpcResponse<'channel:delete'> =>
      runtime.settings.deleteChannel(channelId),
  )
  ipcMain.handle(
    IPC.CHANNEL_TEST,
    (
      _event,
      channelId: IpcRequest<'channel:test'>,
    ): Promise<IpcResponse<'channel:test'>> => runtime.settings.testChannel(channelId),
  )

  return unsubscribe
}
