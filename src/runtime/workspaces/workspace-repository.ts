import type { Workspace } from '../../shared/contracts/workspace.ts'

/**
 * Workspace catalog 的持久化端口。
 *
 * ID 与路径分离：路径只作为 mount 内容持久化，识别工作区始终用稳定 ID，
 * 避免目录改名/移动后 Session 关联漂移。
 */
export interface WorkspaceRepository {
  list(): Workspace[]
  get(workspaceId: string): Workspace | undefined
  create(workspace: Workspace): Workspace
}
