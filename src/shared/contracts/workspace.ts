import type { WorkspaceId } from './ids.ts'

export interface WorkspaceMount {
  workspaceId: WorkspaceId
  path: string
  resolvedAt: number
}

export type WorkspaceMountFailureCode =
  | 'missing'
  | 'not-directory'
  | 'unreadable'

/**
 * 每次 run 前重新检查磁盘的结果。S02 起 run 的 cwd 必须来自可用 mount，
 * 不允许默默回退到旧目录。
 */
export type WorkspaceMountResolution =
  | { ok: true; mount: WorkspaceMount }
  | { ok: false; code: WorkspaceMountFailureCode; path: string }

export interface Workspace {
  id: WorkspaceId
  name: string
  mount?: WorkspaceMount
  createdAt: number
  updatedAt: number
}
