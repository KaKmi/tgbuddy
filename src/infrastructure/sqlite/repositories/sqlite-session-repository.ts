import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite'
import type { ContextUsage } from '../../../shared/contracts/context.ts'
import type { PermissionMode } from '../../../shared/contracts/permission.ts'
import type { SessionMeta } from '../../../shared/contracts/session.ts'
import type { SessionRepository } from '../../../runtime/sessions/session-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface SessionRow {
  id: string
  title: string
  workspace_id: string | null
  channel_id: string | null
  model_id: string | null
  profile_id: string | null
  expert_id: string | null
  pinned: number | null
  archived: number | null
  permission_mode: string | null
  status: string | null
  status_detail: string | null
  last_activity: string | null
  artifact_count: number | null
  context_usage_json: string | null
  origin_session_id: string | null
  origin_message_id: string | null
  created_at: number
  updated_at: number
}

const SELECT_COLUMNS = `
  id,
  title,
  workspace_id,
  channel_id,
  model_id,
  profile_id,
  expert_id,
  pinned,
  archived,
  permission_mode,
  status,
  status_detail,
  last_activity,
  artifact_count,
  context_usage_json,
  origin_session_id,
  origin_message_id,
  created_at,
  updated_at
`

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isContextUsage(value: unknown): value is ContextUsage {
  if (typeof value !== 'object' || value === null) return false
  const usage = value as Record<string, unknown>
  if (
    !isFiniteNumber(usage.usedTokens)
    || !isFiniteNumber(usage.contextWindow)
    || !isFiniteNumber(usage.percent)
    || !isFiniteNumber(usage.outputTokens)
    || !isFiniteNumber(usage.costUsd)
    || !isFiniteNumber(usage.updatedAt)
  ) {
    return false
  }
  if (typeof usage.breakdown !== 'object' || usage.breakdown === null) return false
  const breakdown = usage.breakdown as Record<string, unknown>
  return ['systemPrompt', 'tools', 'messages', 'skills', 'mcp'].every(
    (key) => isFiniteNumber(breakdown[key]),
  )
}

function parseContextUsage(value: string | null, sessionId: string): ContextUsage | undefined {
  if (value === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Session ${sessionId} 的 contextUsage JSON 已损坏`)
  }
  if (!isContextUsage(parsed)) {
    throw new Error(`Session ${sessionId} 的 contextUsage 结构无效`)
  }
  return parsed
}

function parsePermissionMode(value: string | null, sessionId: string): PermissionMode | undefined {
  if (value === null) return undefined
  if (value === 'plan' || value === 'auto' || value === 'bypass') return value
  throw new Error(`Session ${sessionId} 的 permissionMode 无效: ${value}`)
}

function parseStatus(value: string | null, sessionId: string): SessionMeta['status'] {
  if (value === null) return undefined
  if (
    value === 'idle'
    || value === 'running'
    || value === 'done'
    || value === 'failed'
    || value === 'interrupted'
  ) {
    return value
  }
  throw new Error(`Session ${sessionId} 的 status 无效: ${value}`)
}

function rowToSession(row: SessionRow): SessionMeta {
  const contextUsage = parseContextUsage(row.context_usage_json, row.id)
  const permissionMode = parsePermissionMode(row.permission_mode, row.id)
  const status = parseStatus(row.status, row.id)
  const originRef =
    row.origin_session_id !== null && row.origin_message_id !== null
      ? { sessionId: row.origin_session_id, messageId: row.origin_message_id }
      : undefined

  return {
    id: row.id,
    title: row.title,
    ...(row.workspace_id !== null ? { workspaceId: row.workspace_id } : {}),
    ...(row.channel_id !== null ? { channelId: row.channel_id } : {}),
    ...(row.model_id !== null ? { modelId: row.model_id } : {}),
    ...(row.profile_id !== null && row.profile_id !== '' ? { profileId: row.profile_id } : {}),
    ...(row.expert_id !== null ? { expertId: row.expert_id } : {}),
    ...(row.pinned !== null ? { pinned: row.pinned !== 0 } : {}),
    ...(row.archived !== null ? { archived: row.archived !== 0 } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(status ? { status } : {}),
    ...(row.status_detail !== null ? { statusDetail: row.status_detail } : {}),
    ...(row.last_activity !== null ? { lastActivity: row.last_activity } : {}),
    ...(row.artifact_count !== null ? { artifactCount: row.artifact_count } : {}),
    ...(contextUsage ? { contextUsage } : {}),
    ...(originRef ? { originRef } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sessionValues(session: SessionMeta): Array<string | number | null> {
  return [
    session.id,
    session.title,
    session.workspaceId ?? null,
    session.channelId ?? null,
    session.modelId ?? null,
    session.profileId ?? '',
    session.expertId ?? null,
    session.pinned === undefined ? null : session.pinned ? 1 : 0,
    session.archived === undefined ? null : session.archived ? 1 : 0,
    session.permissionMode ?? null,
    session.status ?? null,
    session.statusDetail ?? null,
    session.lastActivity ?? null,
    session.artifactCount ?? null,
    session.contextUsage ? JSON.stringify(session.contextUsage) : null,
    session.originRef?.sessionId ?? null,
    session.originRef?.messageId ?? null,
    session.createdAt,
    session.updatedAt,
  ]
}

function changed(result: StatementResultingChanges): boolean {
  return Number(result.changes) > 0
}

/**
 * `app_sessions` 的 SQLite adapter。所有查询都借用 AppDatabase 已配置的连接，
 * repository 自己不持有第二个连接，应用退出时只需关闭一个 owner。
 */
export class SqliteSessionRepository implements SessionRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  list(workspaceId?: string): SessionMeta[] {
    return this.#appDatabase.use((database) => {
      const rows =
        workspaceId === undefined
          ? database
              .prepare(`SELECT ${SELECT_COLUMNS} FROM app_sessions ORDER BY updated_at DESC, id ASC`)
              .all()
          : database
              .prepare(
                `SELECT ${SELECT_COLUMNS}
                 FROM app_sessions
                 WHERE workspace_id = ?
                 ORDER BY updated_at DESC, id ASC`,
              )
              .all(workspaceId)
      return (rows as unknown as SessionRow[]).map(rowToSession)
    })
  }

  get(sessionId: string): SessionMeta | undefined {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_sessions WHERE id = ?`)
        .get(sessionId) as unknown as SessionRow | undefined
      return row ? rowToSession(row) : undefined
    })
  }

  create(session: SessionMeta): SessionMeta {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_sessions (
             id, title, workspace_id, channel_id, model_id, profile_id, expert_id,
             pinned, archived, permission_mode, status, status_detail,
             last_activity, artifact_count, context_usage_json,
             origin_session_id, origin_message_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...sessionValues(session))
    })
    return this.#require(session.id)
  }

  update(session: SessionMeta): SessionMeta {
    const didUpdate = this.#appDatabase.use((database) =>
      changed(
        database
          .prepare(
            `UPDATE app_sessions
             SET title = ?,
                 workspace_id = ?,
                 channel_id = ?,
                 model_id = ?,
                 profile_id = ?,
                 expert_id = ?,
                 pinned = ?,
                 archived = ?,
                 permission_mode = ?,
                 status = ?,
                 status_detail = ?,
                 last_activity = ?,
                 artifact_count = ?,
                 context_usage_json = ?,
                 origin_session_id = ?,
                 origin_message_id = ?,
                 created_at = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(...sessionValues(session).slice(1), session.id),
      ),
    )
    if (!didUpdate) throw new Error(`Session 不存在: ${session.id}`)
    return this.#require(session.id)
  }

  delete(sessionId: string): boolean {
    return this.#appDatabase.use((database: DatabaseSync) =>
      changed(database.prepare('DELETE FROM app_sessions WHERE id = ?').run(sessionId)),
    )
  }

  #require(sessionId: string): SessionMeta {
    const session = this.get(sessionId)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)
    return session
  }
}
