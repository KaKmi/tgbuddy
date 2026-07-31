import { describe, expect, test } from 'bun:test'
import { PendingRequests } from '../src/runtime/pending/pending-requests.ts'

interface TestRequest {
  requestId: string
  sessionId: string
}

describe('PendingRequests', () => {
  test('AbortSignal 会释放挂起请求', async () => {
    const pending = new PendingRequests<TestRequest, string>(() => 'aborted', () => 'discarded')
    const controller = new AbortController()
    const request = { requestId: 'req-1', sessionId: 'session-1' }

    const result = pending.suspend(request, () => {}, controller.signal)
    expect(pending.list()).toEqual([request])

    controller.abort()

    expect(await result).toBe('aborted')
    expect(pending.list()).toEqual([])
  })

  test('已经中断的 signal 不会把请求发给 UI', async () => {
    const pending = new PendingRequests<TestRequest, string>(() => 'aborted', () => 'discarded')
    const controller = new AbortController()
    controller.abort()
    let sent = false

    const result = pending.suspend(
      { requestId: 'req-2', sessionId: 'session-1' },
      () => {
        sent = true
      },
      controller.signal,
    )

    expect(await result).toBe('aborted')
    expect(sent).toBe(false)
  })

  test('clearSession 只清理目标会话', async () => {
    const pending = new PendingRequests<TestRequest, string>(() => 'aborted', () => 'discarded')
    const first = pending.suspend({ requestId: 'req-3', sessionId: 'session-1' }, () => {})
    void pending.suspend({ requestId: 'req-4', sessionId: 'session-2' }, () => {})

    pending.clearSession('session-1')

    expect(await first).toBe('discarded')
    expect(pending.list()).toEqual([{ requestId: 'req-4', sessionId: 'session-2' }])
  })

  test('推送请求失败时不会留下悬挂记录', async () => {
    const pending = new PendingRequests<TestRequest, string>(() => 'aborted', () => 'discarded')
    const result = pending.suspend({ requestId: 'req-5', sessionId: 'session-1' }, () => {
      throw new Error('窗口已销毁')
    })

    expect(result).rejects.toThrow('窗口已销毁')
    expect(pending.list()).toEqual([])
  })
})
