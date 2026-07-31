import type { AgentRunId, RootRunId, SessionId, WorkspaceId } from './ids.ts'
import type { AttachmentRef } from './attachment.ts'

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface StartRunInput {
  sessionId: string
  text: string
  /** A02：本次消息携带的附件（发送前已落 BlobStore，消息只存 ref） */
  attachments?: AttachmentRef[]
  /** D01：child run 的 lineage（rootRunId + parentToolCallId），root run 不传 */
  lineage?: RunLineage
  /** 显式调用的技能名（用户点了 /skill:xxx） */
  invokeSkill?: string
}

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
