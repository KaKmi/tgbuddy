export type TgBuddyErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERMISSION_DENIED'
  | 'RUNTIME_UNAVAILABLE'
  | 'STORAGE_DEGRADED'
  | 'INTERNAL'

export interface TgBuddyErrorPayload {
  code: TgBuddyErrorCode
  message: string
  recoverable: boolean
}

export class TgBuddyError extends Error {
  readonly code: TgBuddyErrorCode
  readonly recoverable: boolean

  constructor(payload: TgBuddyErrorPayload) {
    super(payload.message)
    this.name = 'TgBuddyError'
    this.code = payload.code
    this.recoverable = payload.recoverable
  }

  toPayload(): TgBuddyErrorPayload {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    }
  }
}
