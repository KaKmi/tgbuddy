/**
 * 每个 Run 独立 ExecutionEnv 的端口。
 *
 * 具体 pi `ExecutionEnv` 类型被挡在 kernel 层：这里只描述生命周期
 * （创建、所属工作区、run settled 后释放），kernel adapter 负责把真实
 * 沙箱环境接到 pi 工具上。
 */
export interface RunExecutionEnv {
  readonly id: string
  readonly workspaceId: string
  readonly mountPath: string
  /** run settled（含中止/失败）后由内核调用；实现必须幂等 */
  dispose(): Promise<void>
}

export interface RunExecutionEnvFactory {
  create(input: {
    workspaceId: string
    mountPath: string
  }): RunExecutionEnv
}
