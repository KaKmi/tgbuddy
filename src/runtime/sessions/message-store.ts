import type { PersistedSessionEntry } from '../../shared/contracts/message.ts'

export interface CreateMessageSessionInput {
  sessionId: string
  cwd: string
  /** 不翻译 pi Message 的前提是持久化并校验明确的内核版本。 */
  kernel: string
}

export interface MessageSession {
  readonly sessionId: string
  entries(): Promise<PersistedSessionEntry[]>
  append(entry: PersistedSessionEntry): Promise<void>
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
