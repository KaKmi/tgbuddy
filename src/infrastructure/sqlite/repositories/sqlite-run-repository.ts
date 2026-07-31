import type { CapabilitySnapshot } from '../../../shared/contracts/run-snapshot.ts'
import type { RunRepository } from '../../../runtime/runs/run-repository.ts'
import type { RunRecord } from '../../../shared/contracts/run-snapshot.ts'
import type { AppDatabase } from '../app-database.ts'

interface RunRow {
  id: string
  session_id: string
  workspace_id: string | null
  root_run_id: string | null
  agent_run_id: string | null
  parent_tool_call_id: string | null
  created_at: number
  settled_at: number | null
  status: RunRecord['status']
  snapshot_json: string
  error: string
}

const SELECT_COLUMNS = `
  id, session_id, workspace_id, root_run_id, agent_run_id, parent_tool_call_id,
  created_at, settled_at, status, snapshot_json, error
`

function rowToRecord(row: RunRow): RunRecord {
  const snapshot = JSON.parse(row.snapshot_json) as CapabilitySnapshot | Record<string, never>
  const hasSnapshot =
    typeof snapshot === 'object'
    && snapshot !== null
    && 'channel' in snapshot
    && 'usage' in snapshot
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.root_run_id ? { rootRunId: row.root_run_id } : {}),
    ...(row.agent_run_id ? { agentRunId: row.agent_run_id } : {}),
    ...(row.parent_tool_call_id
      ? { parentToolCallId: row.parent_tool_call_id }
      : {}),
    createdAt: row.created_at,
    ...(row.settled_at !== null ? { settledAt: row.settled_at } : {}),
    status: row.status,
    ...(hasSnapshot ? { snapshot: snapshot as CapabilitySnapshot } : {}),
    ...(row.error ? { error: row.error } : {}),
  }
}

export class SqliteRunRepository implements RunRepository {
  readonly #appDatabase: AppDatabase

  constructor(appDatabase: AppDatabase) {
    this.#appDatabase = appDatabase
  }

  create(record: RunRecord): RunRecord {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `INSERT INTO app_runs (
             id, session_id, workspace_id, root_run_id, agent_run_id, parent_tool_call_id,
             created_at, settled_at, status, snapshot_json, error
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.sessionId,
          record.workspaceId ?? null,
          record.rootRunId ?? null,
          record.agentRunId ?? null,
          record.parentToolCallId ?? null,
          record.createdAt,
          record.settledAt ?? null,
          record.status,
          JSON.stringify(record.snapshot ?? {}),
          record.error ?? '',
        )
    })
    return this.#require(record.id)
  }

  update(record: RunRecord): RunRecord {
    this.#appDatabase.use((database) => {
      database
        .prepare(
          `UPDATE app_runs
           SET settled_at = ?, status = ?, snapshot_json = ?, error = ?
           WHERE id = ?`,
        )
        .run(
          record.settledAt ?? null,
          record.status,
          JSON.stringify(record.snapshot ?? {}),
          record.error ?? '',
          record.id,
        )
    })
    return this.#require(record.id)
  }

  get(runId: string): RunRecord | undefined {
    return this.#appDatabase.use((database) => {
      const row = database
        .prepare(`SELECT ${SELECT_COLUMNS} FROM app_runs WHERE id = ?`)
        .get(runId) as unknown as RunRow | undefined
      return row ? rowToRecord(row) : undefined
    })
  }

  listBySession(sessionId: string): RunRecord[] {
    return this.#appDatabase.use((database) => {
      const rows = database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM app_runs
           WHERE session_id = ?
           ORDER BY created_at DESC, id ASC`,
        )
        .all(sessionId) as unknown as RunRow[]
      return rows.map(rowToRecord)
    })
  }

  #require(runId: string): RunRecord {
    const record = this.get(runId)
    if (!record) throw new Error(`Run 不存在: ${runId}`)
    return record
  }
}
