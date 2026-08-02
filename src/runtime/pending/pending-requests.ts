/**
 * 跨进程边界挂起一个异步调用，等用户在界面上响应。
 *
 * ## 为什么放在 Runtime
 *
 * permission / plan / ask_user 都需要相同的挂起、终止、清理和恢复语义。
 * S06 把 permission 的挂起注册表迁入 Runtime，S09/S10 的 plan 与 ask_user
 * 复用同一机制，避免多份实现发生漂移。
 *
 * ## 三个逃生口，一个都不能少
 *
 * 1. **AbortSignal** —— 用户点停止时自动拒绝，否则 Promise 挂死、agent 永远不结束
 * 2. **会话结束** —— `clearSession()` 批量拒绝该会话所有挂起请求
 * 3. **渲染进程重载** —— `list()` 让 UI 刷新后能把挂起的请求捞回来
 *
 * 少任何一个，症状都是「界面上没有任何提示，但 Agent 卡住不动」——
 * 极难排查，因为哪里都不报错。
 */

/** 请求至少要能标识自己属于哪个会话，其余字段由使用方定义 */
interface HasSession {
  requestId: string
  sessionId: string
}

export class PendingRequests<TReq extends HasSession, TRes> {
  private readonly map = new Map<
    string,
    { resolve: (v: TRes) => void; request: TReq; cleanup: () => void }
  >()

  /**
   * @param onAbort    signal 触发时用什么值 resolve
   * @param onDiscard  会话结束时用什么值 resolve
   */
  constructor(
    private readonly onAbort: () => TRes,
    private readonly onDiscard: () => TRes,
  ) {}

  /**
   * 挂起。返回的 Promise 只会被 `respond` / abort / `clearSession` 三者之一 settle。
   *
   * @param send 把请求推给渲染进程。必须先登记 pending 再发送，
   *             否则同步响应会在 map 里找不到这条请求。
   */
  suspend(request: TReq, send: (r: TReq) => void, signal?: AbortSignal): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      // ★ pi 把 signal 给你，但明确说了「你有责任 honor 它」
      const abort = (): void => {
        this.settle(request.requestId, this.onAbort())
      }
      const cleanup = (): void => signal?.removeEventListener('abort', abort)

      this.map.set(request.requestId, { resolve, request, cleanup })

      if (signal?.aborted) {
        abort()
        return
      }

      signal?.addEventListener('abort', abort, { once: true })
      try {
        send(request)
      } catch (error) {
        this.map.delete(request.requestId)
        cleanup()
        reject(error)
      }
    })
  }

  /** 用户响应了。返回被兑现的请求，找不到返回 undefined（重复响应/已超时） */
  respond(requestId: string, value: TRes): TReq | undefined {
    return this.settle(requestId, value)
  }

  /** 会话结束时批量拒绝 */
  clearSession(sessionId: string): void {
    for (const [id, p] of this.map) {
      if (p.request.sessionId !== sessionId) continue
      this.settle(id, this.onDiscard())
    }
  }

  /** 渲染进程重载后捞回挂起的请求 */
  list(): TReq[] {
    return [...this.map.values()].map((p) => p.request)
  }

  get(requestId: string): TReq | undefined {
    return this.map.get(requestId)?.request
  }

  private settle(requestId: string, value: TRes): TReq | undefined {
    const pending = this.map.get(requestId)
    if (!pending) return undefined
    this.map.delete(requestId)
    pending.cleanup()
    pending.resolve(value)
    return pending.request
  }
}
