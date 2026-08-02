import type { DelegationTask, DelegationTaskUsage } from '../../../shared/contracts/delegation.ts'
import type { PermissionCeilingSnapshot } from '../../../shared/contracts/run-snapshot.ts'
import {
  DelegationVersionConflictError,
  type DelegationRepository,
} from '../../../runtime/delegation/delegation-repository.ts'
import type { AppDatabase } from '../app-database.ts'

interface DelegationRow {
  id: string
  root_run_id: string
  root_session_id: string
  child_session_id: string
  parent_task_id: string | null
  role: DelegationTask['role']
  title: string
  task: string
  status: DelegationTask['status']
  version: number
  usage_json: string
  permission_ceiling_json: string
  last_activity_at: number
  stop_reason: string | null
  error_code: string | null
  created_at: number
  updated_at: number
}

const COLUMNS = `id, root_run_id, root_session_id, child_session_id, parent_task_id,
  role, title, task, status, version, usage_json, permission_ceiling_json,
  last_activity_at, stop_reason, error_code, created_at, updated_at`

export class SqliteDelegationRepository implements DelegationRepository {
  constructor(readonly appDatabase: AppDatabase) {}

  create(task: DelegationTask): DelegationTask {
    this.appDatabase.use((database) => database.prepare(
      `INSERT INTO app_delegation_tasks (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...taskValues(task)))
    return this.#require(task.id)
  }

  get(taskId: string): DelegationTask | undefined {
    return this.appDatabase.use((database) => {
      const row = database.prepare(`SELECT ${COLUMNS} FROM app_delegation_tasks WHERE id = ?`)
        .get(taskId) as unknown as DelegationRow | undefined
      return row ? rowToTask(row) : undefined
    })
  }

  listByRoot(rootRunId: string): DelegationTask[] {
    return this.appDatabase.use((database) => (
      database.prepare(
        `SELECT ${COLUMNS} FROM app_delegation_tasks WHERE root_run_id = ? ORDER BY created_at ASC, id ASC`,
      ).all(rootRunId) as unknown as DelegationRow[]
    ).map(rowToTask))
  }

  listBySession(rootSessionId: string): DelegationTask[] {
    return this.appDatabase.use((database) => (
      database.prepare(
        `SELECT ${COLUMNS} FROM app_delegation_tasks WHERE root_session_id = ? ORDER BY created_at ASC, id ASC`,
      ).all(rootSessionId) as unknown as DelegationRow[]
    ).map(rowToTask))
  }

  listActive(): DelegationTask[] {
    return this.appDatabase.use((database) => (
      database.prepare(
        `SELECT ${COLUMNS} FROM app_delegation_tasks
         WHERE status IN ('queued', 'starting', 'running', 'stopping')
         ORDER BY created_at ASC, id ASC`,
      ).all() as unknown as DelegationRow[]
    ).map(rowToTask))
  }

  compareAndSet(taskId: string, expectedVersion: number, patch: Partial<DelegationTask>): DelegationTask {
    const current = this.#require(taskId)
    if (current.version !== expectedVersion) throw new DelegationVersionConflictError(taskId)
    const next: DelegationTask = {
      ...current,
      ...patch,
      id: current.id,
      rootRunId: current.rootRunId,
      version: current.version + 1,
    }
    const changed = this.appDatabase.use((database) => database.prepare(
      `UPDATE app_delegation_tasks SET root_session_id = ?, child_session_id = ?, parent_task_id = ?,
       role = ?, title = ?, task = ?, status = ?, version = ?, usage_json = ?, permission_ceiling_json = ?,
       last_activity_at = ?, stop_reason = ?, error_code = ?, created_at = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    ).run(...taskValues(next).slice(2), taskId, expectedVersion))
    if (Number(changed.changes) !== 1) throw new DelegationVersionConflictError(taskId)
    return this.#require(taskId)
  }

  appendUsage(taskId: string, expectedVersion: number, usage: Partial<DelegationTaskUsage>): DelegationTask {
    const current = this.#require(taskId)
    return this.compareAndSet(taskId, expectedVersion, {
      usage: {
        turns: current.usage.turns + (usage.turns ?? 0),
        inputTokens: current.usage.inputTokens + (usage.inputTokens ?? 0),
        outputTokens: current.usage.outputTokens + (usage.outputTokens ?? 0),
        costUsd: current.usage.costUsd + (usage.costUsd ?? 0),
      },
    })
  }

  #require(taskId: string): DelegationTask {
    const task = this.get(taskId)
    if (!task) throw new Error(`子任务不存在：${taskId}`)
    return task
  }
}

function taskValues(task: DelegationTask): Array<string | number | null> {
  return [task.id, task.rootRunId, task.rootSessionId, task.childSessionId, task.parentTaskId ?? null,
    task.role, task.title, task.task, task.status, task.version, JSON.stringify(task.usage),
    JSON.stringify(task.permissionCeiling), task.lastActivityAt, task.stopReason ?? null,
    task.errorCode ?? null, task.createdAt, task.updatedAt]
}

function rowToTask(row: DelegationRow): DelegationTask {
  return {
    id: row.id,
    rootRunId: row.root_run_id,
    rootSessionId: row.root_session_id,
    childSessionId: row.child_session_id,
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    role: row.role,
    title: row.title,
    task: row.task,
    status: row.status,
    version: row.version,
    usage: JSON.parse(row.usage_json) as DelegationTaskUsage,
    permissionCeiling: JSON.parse(row.permission_ceiling_json) as PermissionCeilingSnapshot,
    lastActivityAt: row.last_activity_at,
    ...(row.stop_reason ? { stopReason: row.stop_reason } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
