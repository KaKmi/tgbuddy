/**
 * 全局 Agent 事件监听。
 *
 * ★ 必须挂在 `main.tsx` 的顶层，**永不随组件卸载**。
 *
 * 如果把 IPC 监听放在会话组件里，切换页面或会话导致组件卸载时，
 * 正在运行的流式输出和权限请求都会丢失。
 *
 * 用 `useStore()` 直接操作 atoms，而不是 `useSetAtom` —— 因为这个 hook
 * 不需要订阅任何 atom 的变化，只需要写。这样它自己永远不会因为
 * 状态变化而重新渲染。
 */

import { useEffect } from 'react'
import { useStore } from 'jotai'
import {
  acceptRunFrame,
  applyAgentEvent,
  emptyStreamState,
  indexPendingRequests,
  markersAtom,
  mergePendingRequests,
  messagesBySessionAtom,
  pendingPermissionsAtom,
  pendingPlansAtom,
  pendingAskUserAtom,
  streamStatesAtom,
  type LocalEvent,
  type Marker,
} from '../atoms/agent.ts'
import type { AgentEvent } from '../../shared/types/event.ts'

/** 往某个会话的标记流里追加一条 */
function pushMarker(
  store: ReturnType<typeof useStore>,
  sessionId: string,
  marker: Marker,
): void {
  const map = new Map(store.get(markersAtom))
  map.set(sessionId, [...(map.get(sessionId) ?? []), marker])
  store.set(markersAtom, map)
}

/**
 * 工具卡片从「等待授权」升级到「执行中」的延迟窗口。
 *
 * 实测 pi 的 `tool_start` 比授权请求早约 5ms，120ms 是 24 倍余量。
 * 见 docs/06-设计决策.md 决定 2。
 */
const RUNNING_DELAY_MS = 120

export function useGlobalAgentListeners(): void {
  const store = useStore()

  useEffect(() => {
    /** toolCallId → 待触发的「升级为执行中」定时器 */
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    /** sessionId → 当前接受的 runId，用于丢弃旧流的迟到事件 */
    const activeRunIds = new Map<string, number>()
    let pendingRevision = 0
    let disposed = false

    const dispatch = (sessionId: string, event: AgentEvent | LocalEvent): void => {
      const states = new Map(store.get(streamStatesAtom))
      const prev = states.get(sessionId) ?? emptyStreamState()
      states.set(sessionId, applyAgentEvent(prev, event))
      store.set(streamStatesAtom, states)
    }

    const clearTimer = (toolCallId: string): void => {
      const t = timers.get(toolCallId)
      if (t) {
        clearTimeout(t)
        timers.delete(toolCallId)
      }
    }

    const unsubscribe = window.tgbuddy.agent.onStream((frame) => {
      const { sessionId, runId, payload } = frame
      if (!acceptRunFrame(activeRunIds, sessionId, runId)) return

      // ── agent 通道 ─────────────────────────────────────────────
      if (payload.channel === 'agent') {
        const event = payload.event

        if (event.type === 'message_end') {
          const map = new Map(store.get(messagesBySessionAtom))
          map.set(sessionId, [...(map.get(sessionId) ?? []), event.message])
          store.set(messagesBySessionAtom, map)
        }

        // ★ tool_start 先落在「等待授权」，120ms 后没等到授权请求才升级为「执行中」
        if (event.type === 'tool_start') {
          const { toolCallId } = event
          clearTimer(toolCallId)
          timers.set(
            toolCallId,
            setTimeout(() => {
              timers.delete(toolCallId)
              dispatch(sessionId, { type: 'tool_running', toolCallId })
            }, RUNNING_DELAY_MS),
          )
        }
        if (event.type === 'tool_end') clearTimer(event.toolCallId)

        dispatch(sessionId, event)
        return
      }

      // ── host 通道 ──────────────────────────────────────────────
      const event = payload.event

      switch (event.type) {
        case 'permission_request': {
          pendingRevision++
          // 授权请求赶在定时器之前到了 → 取消升级，卡片留在「等待授权」
          clearTimer(event.request.toolCallId)
          store.set(
            pendingPermissionsAtom,
            mergePendingRequests(store.get(pendingPermissionsAtom), [event.request]),
          )
          break
        }

        case 'permission_resolved': {
          pendingRevision++
          // 主进程发这条时不带 sessionId（它只知道 requestId），所以全表扫一遍
          const map = new Map(store.get(pendingPermissionsAtom))
          for (const [sid, list] of map) {
            const next = list.filter((r) => r.requestId !== event.requestId)
            if (next.length !== list.length) map.set(sid, next)
          }
          store.set(pendingPermissionsAtom, map)
          break
        }

        case 'plan_request': {
          pendingRevision++
          store.set(
            pendingPlansAtom,
            mergePendingRequests(store.get(pendingPlansAtom), [event.request]),
          )
          break
        }

        case 'plan_resolved': {
          pendingRevision++
          // 主进程只知道 requestId，所以全表扫一遍
          const map = new Map(store.get(pendingPlansAtom))
          for (const [sid, list] of map) {
            const next = list.filter((r) => r.requestId !== event.requestId)
            if (next.length !== list.length) map.set(sid, next)
          }
          store.set(pendingPlansAtom, map)
          break
        }

        case 'ask_user_request': {
          pendingRevision++
          store.set(
            pendingAskUserAtom,
            mergePendingRequests(store.get(pendingAskUserAtom), [event.request]),
          )
          break
        }

        case 'ask_user_resolved': {
          pendingRevision++
          const map = new Map(store.get(pendingAskUserAtom))
          for (const [sid, list] of map) {
            const next = list.filter((request) => request.requestId !== event.requestId)
            if (next.length !== list.length) map.set(sid, next)
          }
          store.set(pendingAskUserAtom, map)
          break
        }

        case 'pending_requests_cleared': {
          pendingRevision++
          const permissions = new Map(store.get(pendingPermissionsAtom))
          for (const request of permissions.get(sessionId) ?? []) clearTimer(request.toolCallId)
          permissions.delete(sessionId)
          store.set(pendingPermissionsAtom, permissions)

          const plans = new Map(store.get(pendingPlansAtom))
          plans.delete(sessionId)
          store.set(pendingPlansAtom, plans)

          const questions = new Map(store.get(pendingAskUserAtom))
          questions.delete(sessionId)
          store.set(pendingAskUserAtom, questions)
          break
        }

        case 'mode_changed': {
          const label = { plan: '计划模式', auto: '默认权限', bypass: '完全访问' }[event.mode]
          const by = event.source === 'tool' ? '（由助手切换）' : ''
          pushMarker(store, sessionId, {
            id: `mode-${Date.now()}`,
            kind: 'mode_changed',
            text: `已切换到「${label}」${by}`,
          })
          break
        }

        case 'retry': {
          pushMarker(store, sessionId, {
            id: `retry-${Date.now()}`,
            kind: 'retry',
            text: `第 ${event.attempt} 次重试（${event.reason}）`,
          })
          break
        }

        case 'host_error': {
          const states = new Map(store.get(streamStatesAtom))
          const prev = states.get(sessionId) ?? emptyStreamState()
          states.set(sessionId, { ...prev, running: false, error: event.message })
          store.set(streamStatesAtom, states)
          break
        }

        // TODO(阶段 6): compaction_start / compaction_end
        // TODO(阶段 7.5): expert_changed  ／ TODO: title_updated
        default:
          break
      }
    })

    // 先订阅再读全量快照。读取期间若有请求事件，丢弃旧快照并重取，
    // 避免已经处理掉的请求被迟到的快照重新加回界面。
    const restorePendingRequests = async (): Promise<void> => {
      while (!disposed) {
        const revision = pendingRevision
        const [permissions, plans, questions] = await Promise.all([
          window.tgbuddy.permission.pending(),
          window.tgbuddy.plan.pending(),
          window.tgbuddy.askUser.pending(),
        ])
        if (disposed) return
        if (revision !== pendingRevision) continue

        store.set(pendingPermissionsAtom, indexPendingRequests(permissions))
        store.set(pendingPlansAtom, indexPendingRequests(plans))
        store.set(pendingAskUserAtom, indexPendingRequests(questions))
        return
      }
    }

    void restorePendingRequests().catch((error: unknown) => {
      console.error('[Agent 监听] 恢复挂起请求失败：', error)
    })

    return () => {
      disposed = true
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      activeRunIds.clear()
      unsubscribe()
    }
  }, [store])
}
