import { describe, expect, test } from 'bun:test'
import {
  createWorkspaceService,
  type WorkspaceService,
} from '../../../src/runtime/workspaces/workspace-service.ts'
import type { WorkspaceRepository } from '../../../src/runtime/workspaces/workspace-repository.ts'
import type { SessionRepository } from '../../../src/runtime/sessions/session-repository.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'
import type { Workspace } from '../../../src/shared/contracts/workspace.ts'

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, Workspace>()

  list(): Workspace[] {
    return [...this.workspaces.values()].sort(
      (left, right) => left.createdAt - right.createdAt,
    )
  }

  get(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId)
  }

  create(workspace: Workspace): Workspace {
    this.workspaces.set(workspace.id, workspace)
    return workspace
  }
}

class MemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, SessionMeta>()

  list(workspaceId?: string): SessionMeta[] {
    return [...this.sessions.values()].filter(
      (session) => workspaceId === undefined || session.workspaceId === workspaceId,
    )
  }

  get(sessionId: string): SessionMeta | undefined {
    return this.sessions.get(sessionId)
  }

  create(session: SessionMeta): SessionMeta {
    this.sessions.set(session.id, session)
    return session
  }

  update(session: SessionMeta): SessionMeta {
    if (!this.sessions.has(session.id)) throw new Error(`Session 不存在: ${session.id}`)
    this.sessions.set(session.id, session)
    return session
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }
}

const paths = {
  resolve: (path: string) => path.replace(/[\\/]+$/, ''),
  key: (path: string) => paths.resolve(path).toLowerCase(),
  name: (path: string) =>
    paths.resolve(path).split(/[\\/]/).filter(Boolean).at(-1) ?? '工作区',
}

function createService(options?: {
  repository?: MemoryWorkspaceRepository
  sessions?: MemorySessionRepository
}): {
  service: WorkspaceService
  repository: MemoryWorkspaceRepository
  sessions: MemorySessionRepository
} {
  const repository = options?.repository ?? new MemoryWorkspaceRepository()
  const sessions = options?.sessions ?? new MemorySessionRepository()
  let id = 0
  const service = createWorkspaceService({
    repository,
    sessions,
    createId: () => `ws-${++id}`,
    now: () => 1000,
    paths,
  })
  return { service, repository, sessions }
}

describe('WorkspaceService', () => {
  test('create 从路径生成名称与 mount，list/current 可见', () => {
    const { service } = createService()

    const created = service.create({ path: 'C:\\work\\risk-q2' })

    expect(created).toEqual({
      id: 'ws-1',
      name: 'risk-q2',
      mount: {
        workspaceId: 'ws-1',
        path: 'C:\\work\\risk-q2',
        resolvedAt: 1000,
      },
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(service.list()).toEqual([created])
    expect(service.current()).toEqual(created)
  })

  test('同路径去重：再次 create 返回已有工作区而不是新建', () => {
    const { service } = createService()

    const first = service.create({ path: 'C:\\work\\risk' })
    const second = service.create({ path: 'C:\\work\\risk' })

    expect(second.id).toBe(first.id)
    expect(service.list()).toHaveLength(1)
  })

  test('路径比较键归一大小写与尾部分隔符', () => {
    const { service } = createService()

    const first = service.create({ path: 'C:\\WORK\\risk\\' })
    const second = service.create({ path: 'c:\\work\\risk' })

    expect(second.id).toBe(first.id)
  })

  test('select 切换当前工作区，未知 id 抛错', () => {
    const { service } = createService()
    const first = service.create({ path: 'C:\\work\\a' })
    const second = service.create({ path: 'C:\\work\\b' })

    expect(service.current()?.id).toBe(first.id)
    expect(service.select(second.id)).toEqual(second)
    expect(service.current()?.id).toBe(second.id)
    expect(() => service.select('missing')).toThrow(/Workspace 不存在/)
  })

  test('ensureDefault：空 catalog 创建默认工作区并绑定无工作区会话，再次调用幂等', () => {
    const sessions = new MemorySessionRepository()
    sessions.create({
      id: 's1',
      title: '旧会话',
      createdAt: 1,
      updatedAt: 2,
    })
    sessions.create({
      id: 's2',
      title: '已有工作区会话',
      workspaceId: 'ws-x',
      createdAt: 1,
      updatedAt: 2,
    })
    const { service, repository } = createService({ sessions })

    const defaultWorkspace = service.ensureDefault('C:\\project')

    expect(defaultWorkspace.id).toBe('ws-1')
    expect(defaultWorkspace.name).toBe('project')
    expect(repository.list()).toHaveLength(1)
    expect(sessions.get('s1')?.workspaceId).toBe('ws-1')
    expect(sessions.get('s2')?.workspaceId).toBe('ws-x')

    const again = service.ensureDefault('C:\\project')
    expect(again.id).toBe('ws-1')
    expect(repository.list()).toHaveLength(1)
  })
})
