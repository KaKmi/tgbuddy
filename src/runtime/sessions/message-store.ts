import type { PersistedSessionEntry } from '../../shared/contracts/message.ts'

export interface CreateMessageSessionInput {
  sessionId: string
  cwd: string
  /** 不翻译 pi Message 的前提是持久化并校验明确的内核版本。 */
  kernel: string
}

export interface MessageSession {
  readonly sessionId: string
  /** 完整审计日志，包含已经离开 active path 的 entry。 */
  entries(): Promise<PersistedSessionEntry[]>
  /** 当前线性会话从根到 leaf 的有效路径。 */
  activeEntries(): Promise<PersistedSessionEntry[]>
  append(entry: PersistedSessionEntry): Promise<void>
  moveTo(entryId: string | null): Promise<void>
  close(): Promise<void>
}

/**
 * Runtime 只依赖 entry store 能力，不知道 SQLite、Node 或 pi repository。
 */
export interface MessageStore {
  create(input: CreateMessageSessionInput): Promise<MessageSession>
  open(sessionId: string, kernel: string): Promise<MessageSession | undefined>
  delete(sessionId: string): Promise<void>
  dispose(): Promise<void>
}
