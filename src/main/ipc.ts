/**
 * IPC 注册。
 *
 * 加一个新通道要同步改四处（见 shared/ipc.ts 的说明）：
 * 这里是第二处。
 */

import { ipcMain, type BrowserWindow } from 'electron'
import { IPC, type PermissionResponse, type SendInput, type SessionMeta } from '../shared/ipc.ts'
import type { HostEvent, StreamFrame } from '../shared/types/event.ts'
import type { AskUserResponse, PermissionMode, PlanResponse } from '../shared/types/permission.ts'
import type { Channel } from '../shared/types/channel.ts'
import { listChannels, saveChannels } from './channel-store.ts'
import * as orchestrator from './orchestrator.ts'
import * as permission from './permission-service.ts'
import * as plan from './plan-service.ts'
import * as askUser from './ask-user-service.ts'
import * as compaction from './compaction-service.ts'
import * as store from './session-store.ts'

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /**
   * 事件推送。
   *
   * 注意窗口可能已经销毁（用户关窗但 Agent 还在跑），
   * 所以每次都要检查 isDestroyed，否则会抛 "Object has been destroyed"。
   */
  const sendFrame = (frame: StreamFrame): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC.AGENT_STREAM, frame)
  }

  /** 推一条 host 事件。不属于某次 run 的用空 sessionId + runId 0 */
  const pushHost = (event: HostEvent, sessionId = '', runId = 0): void =>
    sendFrame({ sessionId, runId, payload: { channel: 'host', event } })

  // ── 会话 ────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SESSION_LIST, (): SessionMeta[] => store.listSessions())

  ipcMain.handle(
    IPC.SESSION_CREATE,
    (_e, input: { title?: string; channelId?: string; modelId?: string }): SessionMeta =>
      store.createSession(input ?? {}),
  )

  ipcMain.handle(IPC.SESSION_DELETE, (_e, id: string): void => {
    compaction.clearSession(id)
    store.deleteSession(id)
    // 会话级规则跟着会话一起走，project/global 的留着 —— 那是用户攒的资产
    permission.expireSessionRules(id)
  })

  ipcMain.handle(IPC.SESSION_MESSAGES, (_e, id: string) => store.getMessages(id))

  ipcMain.handle(IPC.SESSION_COMPACTED_MESSAGES, (_e, id: string, compactionId: string) =>
    store.getCompactedMessages(id, compactionId),
  )

  ipcMain.handle(IPC.SESSION_UPDATE_META, (_e, id: string, patch: Partial<SessionMeta>): void =>
    store.updateMeta(id, patch),
  )

  // ── Agent ───────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_SEND, async (_e, input: SendInput): Promise<void> => {
    // 故意不 await —— 让 IPC 立刻返回，流式内容通过 AGENT_STREAM 推送。
    // await 的话渲染进程会一直卡在这个 invoke 上直到整轮跑完。
    void orchestrator.send(input, sendFrame)
  })

  ipcMain.handle(IPC.AGENT_STOP, (_e, sessionId: string): void => orchestrator.stop(sessionId))

  // ── 权限 ────────────────────────────────────────────────────────
  ipcMain.handle(IPC.PERMISSION_RESPOND, (_e, res: PermissionResponse): void => {
    permission.respond(res)
    // 收尾事件，让 UI 把卡片从「等待授权」切走
    pushHost({ type: 'permission_resolved', requestId: res.requestId, allowed: res.allowed })
  })

  // ★ 逃生口 3：渲染进程重载后把挂起的请求捞回来
  ipcMain.handle(IPC.PERMISSION_PENDING, () => permission.getPending())

  // ── 计划模式 ────────────────────────────────────────────────────
  ipcMain.handle(IPC.PLAN_RESPOND, (_e, res: PlanResponse): void => {
    plan.respond(res)
    pushHost({ type: 'plan_resolved', requestId: res.requestId, approved: res.approved })
  })

  ipcMain.handle(IPC.PLAN_PENDING, () => plan.getPending())

  ipcMain.handle(IPC.ASK_USER_RESPOND, (_e, res: AskUserResponse): void => {
    askUser.respond(res)
    pushHost({ type: 'ask_user_resolved', requestId: res.requestId })
  })

  ipcMain.handle(IPC.ASK_USER_PENDING, () => askUser.getPending())

  ipcMain.handle(IPC.MODE_SET, (_e, sessionId: string, mode: PermissionMode): void => {
    permission.setMode(sessionId, mode)
    store.updateMeta(sessionId, { permissionMode: mode })
    // source='user' —— UI 据此区分是用户点的还是模型自己切的
    pushHost({ type: 'mode_changed', mode, source: 'user' }, sessionId)
  })

  ipcMain.handle(IPC.COMPACTION_START, (_e, sessionId: string): void => {
    void compaction.start(sessionId, sendFrame, () => orchestrator.isRunning(sessionId))
  })
  ipcMain.handle(IPC.COMPACTION_DEFER, (_e, sessionId: string): void => {
    compaction.defer(sessionId, sendFrame)
  })
  ipcMain.handle(IPC.COMPACTION_CANCEL, (_e, sessionId: string): void => {
    compaction.cancel(sessionId, sendFrame)
  })

  // ── 渠道 ────────────────────────────────────────────────────────
  ipcMain.handle(IPC.CHANNEL_LIST, (): Channel[] => listChannels())

  ipcMain.handle(IPC.CHANNEL_SAVE, (_e, channel: Channel): void => {
    const list = listChannels().filter((c) => c.id !== channel.id)
    saveChannels([...list, channel])
  })

  ipcMain.handle(IPC.CHANNEL_DELETE, (_e, id: string): void => {
    saveChannels(listChannels().filter((c) => c.id !== id))
  })

  ipcMain.handle(IPC.CHANNEL_TEST, async (_e, _id: string) => {
    // TODO(阶段 4): 发一条最小请求验证连通性，返回可用模型列表
    return { success: false, message: '未实现' }
  })
}
