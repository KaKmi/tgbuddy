import type { WorkspaceId } from './ids.ts'

export interface WorkspaceMount {
  workspaceId: WorkspaceId
  path: string
  resolvedAt: number
}

export interface Workspace {
  id: WorkspaceId
  name: string
  mount?: WorkspaceMount
  createdAt: number
  updatedAt: number
}
