import type { AgentRunId, RootRunId, SessionId, WorkspaceId } from './ids.ts'
import type { AttachmentRef } from './attachment.ts'

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface StartRunInput {
  sessionId: string
  text: string
  /** Runtime 在构造 invocation 前预留的稳定运行身份。 */
  identity?: RunIdentity
  /** A02：本次消息携带的附件（发送前已落 BlobStore，消息只存 ref） */
  attachments?: AttachmentRef[]
  /** D01：child run 的 lineage（rootRunId + parentToolCallId），root run 不传 */
  lineage?: RunLineage
  /** 显式调用的技能名（用户点了 /skill:xxx） */
  invokeSkill?: string
}

export interface PermissionSubject {
  rootSessionId: string
  rootRunId: string
  agentRunId: string
  executionSessionId: string
  delegationId?: string
  role: 'root' | 'explorer' | 'worker'
}

export interface RunIdentity extends PermissionSubject {
  parentToolCallId?: string
}

export interface RunLineage {
  workspaceId: WorkspaceId
  sessionId: SessionId
  rootRunId: RootRunId
  agentRunId: AgentRunId
  parentToolCallId?: string
  /** D03：child 归属的 root 会话（权限/取消级联用） */
  parentSessionId?: string
}

export interface RunRecord extends RunLineage {
  status: RunStatus
  startedAt: number
  settledAt?: number
  errorMessage?: string
}
