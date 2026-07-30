import type { SessionMeta } from '../../shared/contracts/session.ts'

/**
 * Session catalog 的持久化端口。
 *
 * ID、时间戳和默认标题由上层用例决定，repository 只保证完整元数据的持久化，
 * 避免基础设施层悄悄引入第二套时钟或 ID 规则。
 */
export interface SessionRepository {
  list(workspaceId?: string): SessionMeta[]
  get(sessionId: string): SessionMeta | undefined
  create(session: SessionMeta): SessionMeta
  update(session: SessionMeta): SessionMeta
  delete(sessionId: string): boolean
}
