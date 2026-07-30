import { afterEach, describe, expect, test } from 'bun:test'
import {
  configureSessionRepository,
  getSession,
  updateMeta,
} from '../../../src/main/session-store.ts'
import type { SessionRepository } from '../../../src/runtime/index.ts'
import type { SessionMeta } from '../../../src/shared/contracts/session.ts'

class CatalogProbe implements SessionRepository {
  session: SessionMeta = {
    id: 'session-1',
    title: 'SQLite 会话',
    createdAt: 1,
    updatedAt: 1,
  }

  list(): SessionMeta[] {
    return [this.session]
  }

  get(sessionId: string): SessionMeta | undefined {
    return sessionId === this.session.id ? this.session : undefined
  }

  create(session: SessionMeta): SessionMeta {
    this.session = session
    return session
  }

  update(session: SessionMeta): SessionMeta {
    this.session = session
    return session
  }

  delete(): boolean {
    return false
  }
}

afterEach(() => configureSessionRepository(undefined))

describe('legacy 消息链路的 Session catalog bridge', () => {
  test('orchestrator 仍通过 session-store 读取和更新同一个 SQLite catalog', () => {
    const repository = new CatalogProbe()
    configureSessionRepository(repository)

    expect(getSession('session-1')?.title).toBe('SQLite 会话')
    updateMeta('session-1', { status: 'running' })

    expect(repository.session).toMatchObject({
      id: 'session-1',
      title: 'SQLite 会话',
      status: 'running',
    })
    expect(repository.session.updatedAt).toBeGreaterThan(1)
  })
})
