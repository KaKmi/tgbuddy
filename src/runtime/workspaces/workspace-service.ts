import type { WorkspaceCommands } from '../app/agent-runtime.ts'
import type { SessionRepository } from '../sessions/session-repository.ts'
import type { Workspace } from '../../shared/contracts/workspace.ts'
import type { WorkspaceRepository } from './workspace-repository.ts'

/**
 * 路径语义端口。
 *
 * Runtime 不依赖 Node path：绝对化、大小写归一和目录名提取都从这里注入，
 * 去重与命名规则仍由本服务持有，端口只提供平台事实。
 */
export interface WorkspacePathPort {
  /** 绝对化路径，用于持久化与展示 */
  resolve(path: string): string
  /** 去重比较键：平台大小写与尾部分隔符归一 */
  key(path: string): string
  /** 从路径生成默认工作区名 */
  name(path: string): string
}

export interface CreateWorkspaceServiceOptions {
  repository: WorkspaceRepository
  sessions: SessionRepository
  createId(): string
  now(): number
  paths: WorkspacePathPort
}

/**
 * S01 的服务接口比门面多一个 `ensureDefault`：默认工作区只由
 * Composition Root 在启动时调用，不暴露给 IPC/Renderer。
 */
export interface WorkspaceService extends WorkspaceCommands {
  ensureDefault(path: string): Workspace
}

/**
 * Workspace catalog 与选择状态。
 *
 * 选择状态由 Runtime 显式持有（`#currentWorkspaceId`），Renderer 只镜像它；
 * `current()` 在未选择时回退到最早创建的工作区，保证重启后默认可见。
 */
export function createWorkspaceService(
  options: CreateWorkspaceServiceOptions,
): WorkspaceService {
  let currentWorkspaceId: string | undefined

  const list = (): Workspace[] => options.repository.list()

  const findByPath = (path: string): Workspace | undefined => {
    const key = options.paths.key(options.paths.resolve(path))
    return list().find(
      (workspace) =>
        workspace.mount !== undefined
        && options.paths.key(workspace.mount.path) === key,
    )
  }

  const create = (input: { path: string }): Workspace => {
    const existing = findByPath(input.path)
    if (existing) return existing
    const resolved = options.paths.resolve(input.path)
    const now = options.now()
    const id = options.createId()
    const workspace = options.repository.create({
      id,
      name: options.paths.name(resolved),
      mount: { workspaceId: id, path: resolved, resolvedAt: now },
      createdAt: now,
      updatedAt: now,
    })
    currentWorkspaceId ??= workspace.id
    return workspace
  }

  const select = (workspaceId: string): Workspace => {
    const workspace = options.repository.get(workspaceId)
    if (!workspace) throw new Error(`Workspace 不存在: ${workspaceId}`)
    currentWorkspaceId = workspaceId
    return workspace
  }

  const current = (): Workspace | undefined => {
    if (currentWorkspaceId !== undefined) {
      return options.repository.get(currentWorkspaceId)
    }
    return list()[0]
  }

  const ensureDefault = (path: string): Workspace => {
    const existing = list()[0]
    const workspace = existing ?? create({ path })
    currentWorkspaceId ??= workspace.id
    const now = options.now()
    for (const session of options.sessions.list()) {
      if (session.workspaceId === undefined) {
        options.sessions.update({
          ...session,
          workspaceId: workspace.id,
          updatedAt: now,
        })
      }
    }
    return workspace
  }

  return { list, create, select, current, ensureDefault }
}
