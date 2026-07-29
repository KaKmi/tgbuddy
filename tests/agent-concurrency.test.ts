import { describe, expect, test } from 'bun:test'
import {
  acceptRunFrame,
  indexPendingRequests,
  mergePendingRequests,
  updateSessionMode,
} from '../src/renderer/atoms/agent.ts'

interface TestRequest {
  requestId: string
  sessionId: string
}

describe('Agent 并发状态', () => {
  test('旧 run 的迟到帧会被丢弃', () => {
    const active = new Map<string, number>()

    expect(acceptRunFrame(active, 'session-1', 10)).toBe(true)
    expect(acceptRunFrame(active, 'session-1', 9)).toBe(false)
    expect(acceptRunFrame(active, 'session-1', 11)).toBe(true)
    expect(acceptRunFrame(active, 'session-2', 1)).toBe(true)
  })

  test('挂起请求快照按会话合并并去重', () => {
    const current = new Map<string, TestRequest[]>([
      ['session-1', [{ requestId: 'req-1', sessionId: 'session-1' }]],
    ])

    const merged = mergePendingRequests(current, [
      { requestId: 'req-1', sessionId: 'session-1' },
      { requestId: 'req-2', sessionId: 'session-1' },
      { requestId: 'req-3', sessionId: 'session-2' },
    ])

    expect(merged.get('session-1')?.map((item) => item.requestId)).toEqual(['req-1', 'req-2'])
    expect(merged.get('session-2')?.map((item) => item.requestId)).toEqual(['req-3'])
  })

  test('全量快照不会保留已经消失的旧请求', () => {
    const snapshot = indexPendingRequests<TestRequest>([
      { requestId: 'req-2', sessionId: 'session-1' },
    ])

    expect(snapshot.get('session-1')?.map((item) => item.requestId)).toEqual(['req-2'])
    expect(snapshot.has('session-2')).toBe(false)
  })

  test('模式事件只更新对应会话的 Chip 状态', () => {
    const sessions = [
      { id: 'session-1', title: '一', createdAt: 1, updatedAt: 1, permissionMode: 'auto' as const },
      { id: 'session-2', title: '二', createdAt: 1, updatedAt: 1, permissionMode: 'auto' as const },
    ]

    const updated = updateSessionMode(sessions, 'session-1', 'plan')

    expect(updated[0]?.permissionMode).toBe('plan')
    expect(updated[1]?.permissionMode).toBe('auto')
  })
})
