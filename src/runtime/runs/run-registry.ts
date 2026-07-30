export interface ActiveRun {
  sessionId: string
  runId: number
  startedAt: number
  signal: AbortSignal
}

export interface RunRegistryOptions {
  now(): number
}

/**
 * Runtime 内的单会话 single-flight 注册表。
 *
 * generation token 让迟到的旧 Run 无法释放同 Session 的新 Run；真正的
 * AbortController 在 K10 接入，这里只负责所有权和生命周期。
 */
export class RunRegistry {
  readonly #now: () => number
  readonly #active = new Map<
    string,
    ActiveRun & { controller: AbortController }
  >()
  #sequence = 0
  #disposed = false

  constructor(options: RunRegistryOptions) {
    this.#now = options.now
  }

  start(sessionId: string): ActiveRun | undefined {
    if (this.#disposed) throw new Error('RunRegistry 已关闭')
    if (this.#active.has(sessionId)) return undefined

    const controller = new AbortController()
    const run = {
      sessionId,
      runId: ++this.#sequence,
      startedAt: this.#now(),
      signal: controller.signal,
      controller,
    }
    this.#active.set(sessionId, run)
    return run
  }

  cancel(sessionId: string): boolean {
    const run = this.#active.get(sessionId)
    if (!run || run.signal.aborted) return false
    run.controller.abort()
    return true
  }

  settle(run: ActiveRun): boolean {
    if (this.#active.get(run.sessionId)?.runId !== run.runId) return false
    this.#active.delete(run.sessionId)
    return true
  }

  isRunning(sessionId: string): boolean {
    return this.#active.has(sessionId)
  }

  dispose(): ActiveRun[] {
    if (this.#disposed) return []
    this.#disposed = true
    const active = [...this.#active.values()]
    for (const run of active) run.controller.abort()
    this.#active.clear()
    return active
  }
}
