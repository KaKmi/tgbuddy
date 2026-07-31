import type {
  RunRecord,
  RunRecordStatus,
} from '../../shared/contracts/run-snapshot.ts'

export type { RunRecord, RunRecordStatus }

export interface RunRepository {
  create(record: RunRecord): RunRecord
  update(record: RunRecord): RunRecord
  get(runId: string): RunRecord | undefined
  listBySession(sessionId: string): RunRecord[]
}

export class MemoryRunRepository implements RunRepository {
  readonly #records = new Map<string, RunRecord>()

  create(record: RunRecord): RunRecord {
    this.#records.set(record.id, record)
    return record
  }

  update(record: RunRecord): RunRecord {
    this.#records.set(record.id, record)
    return record
  }

  get(runId: string): RunRecord | undefined {
    return this.#records.get(runId)
  }

  listBySession(sessionId: string): RunRecord[] {
    return [...this.#records.values()]
      .filter((record) => record.sessionId === sessionId)
      .sort((left, right) => right.createdAt - left.createdAt)
  }
}
