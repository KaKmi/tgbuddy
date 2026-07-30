import type { NoticeMessage } from '../../shared/contracts/message.ts'
import type { SessionMeta } from '../../shared/contracts/session.ts'
import type { SessionRepository } from '../sessions/session-repository.ts'

export interface RunRecoveryHistory {
  append(sessionId: string, message: NoticeMessage): Promise<void>
}

export interface RecoverInterruptedRunsOptions {
  sessions: SessionRepository
  history: RunRecoveryHistory
  createId(): string
  now(): number
}

export interface RunRecoveryFailure {
  sessionId: string
  stage: 'catalog' | 'history'
  message: string
}

export interface InterruptedRunRecoveryReport {
  recovered: SessionMeta[]
  failures: RunRecoveryFailure[]
}

/**
 * 把进程退出时遗留的 running 状态收口。
 *
 * catalog 是恢复判定的 canonical 状态，因此先提交 interrupted，再补时间线标记；
 * 标记失败只产生诊断，不能让会话永久卡在“运行中”或阻止应用启动。
 */
export async function recoverInterruptedRuns(
  options: RecoverInterruptedRunsOptions,
): Promise<InterruptedRunRecoveryReport> {
  const recovered: SessionMeta[] = []
  const failures: RunRecoveryFailure[] = []

  for (const session of options.sessions.list()) {
    if (session.status !== 'running') continue

    const recoveredAt = options.now()
    let interrupted: SessionMeta
    try {
      interrupted = options.sessions.update({
        ...session,
        status: 'interrupted',
        statusDetail: '上次运行被意外中断',
        lastActivity: undefined,
        updatedAt: recoveredAt,
      })
      recovered.push(interrupted)
    } catch (error) {
      failures.push({
        sessionId: session.id,
        stage: 'catalog',
        message: errorMessage(error),
      })
      continue
    }

    try {
      await options.history.append(session.id, {
        kind: 'notice',
        id: options.createId(),
        createdAt: recoveredAt,
        notice: 'session_resumed',
        text: '应用上次退出时任务仍在运行，已标记为中断。你可以继续发送消息。',
        display: true,
      })
    } catch (error) {
      failures.push({
        sessionId: session.id,
        stage: 'history',
        message: errorMessage(error),
      })
    }
  }

  return { recovered, failures }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
