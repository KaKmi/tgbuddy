import type { ArtifactId, AgentRunId, SessionId, WorkspaceId } from './ids.ts'

export type ArtifactKind = 'file' | 'image' | 'document' | 'tool-output'

export interface ArtifactRef {
  id: ArtifactId
  workspaceId: WorkspaceId
  sessionId: SessionId
  producerRunId: AgentRunId
  kind: ArtifactKind
  name: string
  path?: string
  blobId?: string
  createdAt: number
}
