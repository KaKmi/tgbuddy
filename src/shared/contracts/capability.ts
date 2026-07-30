import type { CapabilityId } from './ids.ts'

export type CapabilityKind = 'tool' | 'skill' | 'mcp' | 'delegation'
export type CapabilityRisk = 'read' | 'write' | 'execute'

export interface CapabilityDescriptor {
  id: CapabilityId
  name: string
  kind: CapabilityKind
  risk: CapabilityRisk
  description: string
  tokenEstimate: number
}
