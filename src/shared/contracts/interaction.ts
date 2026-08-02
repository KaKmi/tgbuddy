export type HumanInteractionKind = 'permission' | 'plan' | 'ask_user'

export interface EventSource {
  rootRunId: string
  runId: string
  sessionId: string
  subjectId: string
  taskId?: string
  toolCallId?: string
}

export interface HumanInteractionRequest {
  id: string
  kind: HumanInteractionKind
  source: EventSource
  active: boolean
  queuePosition: number
}

export interface DelegationAttention {
  kind: 'permission' | 'user' | 'plan'
  interactionId: string
  active: boolean
  queuePosition: number
}
