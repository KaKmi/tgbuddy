import { describe, expect, test } from 'bun:test'
import {
  firstModalPermissionRequest,
  pendingPermissionCount,
} from '../src/renderer/atoms/agent.ts'
import type { PermissionRequest } from '../src/shared/types/permission.ts'

function request(
  requestId: string,
  sessionId: string,
  requiresModal: boolean,
): PermissionRequest {
  return {
    requestId,
    sessionId,
    toolCallId: `tool-${requestId}`,
    toolName: requiresModal ? 'bash' : 'write',
    args: requiresModal
      ? { command: 'rm -rf tmp/cache' }
      : { path: 'C:\\work\\a.md' },
    risk: requiresModal ? 'high' : 'medium',
    requiresModal,
    neverPersist: requiresModal,
    suggestedGrants: [],
  }
}

describe('权限模态状态', () => {
  test('普通 ask（低/中风险）不触发模态，只进 inline 队列', () => {
    const pending = new Map<string, PermissionRequest[]>()
    pending.set('session-1', [
      request('req-inline-1', 'session-1', false),
      request('req-inline-2', 'session-1', false),
    ])

    expect(firstModalPermissionRequest(pending)).toBeUndefined()
    expect(pendingPermissionCount(pending)).toBe(2)
  })

  test('高危请求跨会话仍被模态选中（按登记顺序取第一个）', () => {
    const pending = new Map<string, PermissionRequest[]>()
    pending.set('session-1', [request('req-a', 'session-1', false)])
    pending.set('session-2', [
      request('req-danger-1', 'session-2', true),
      request('req-danger-2', 'session-2', true),
    ])
    pending.set('session-3', [request('req-b', 'session-3', false)])

    expect(firstModalPermissionRequest(pending)?.requestId).toBe('req-danger-1')
    expect(pendingPermissionCount(pending)).toBe(4)
  })

  test('模态请求解决后轮到下一个高危请求', () => {
    const pending = new Map<string, PermissionRequest[]>()
    pending.set('session-2', [
      request('req-danger-1', 'session-2', true),
      request('req-danger-2', 'session-2', true),
    ])
    const next = new Map(pending)
    next.set('session-2', [
      request('req-danger-2', 'session-2', true),
    ])

    expect(firstModalPermissionRequest(pending)?.requestId).toBe('req-danger-1')
    expect(firstModalPermissionRequest(next)?.requestId).toBe('req-danger-2')
  })
})
