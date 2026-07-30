import type { AgentRunId, RootRunId, SessionId, WorkspaceId } from './ids.ts'

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface RunLineage {
  workspaceId: WorkspaceId
  sessionId: SessionId
  rootRunId: RootRunId
  agentRunId: AgentRunId
  parentToolCallId?: string
}

export interface RunRecord extends RunLineage {
  status: RunStatus
  startedAt: number
  settledAt?: number
  errorMessage?: string
}
