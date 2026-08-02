import type { PermissionCeilingSnapshot } from './run-snapshot.ts'

export type DelegationTaskStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface DelegationTaskUsage {
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface DelegationTask {
  id: string
  rootRunId: string
  rootSessionId: string
  childSessionId: string
  parentTaskId?: string
  role: 'explorer' | 'worker'
  title: string
  task: string
  status: DelegationTaskStatus
  version: number
  usage: DelegationTaskUsage
  permissionCeiling: PermissionCeilingSnapshot
  lastActivityAt: number
  stopReason?: string
  errorCode?: string
  createdAt: number
  updatedAt: number
}
