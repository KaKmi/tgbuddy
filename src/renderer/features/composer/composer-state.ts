import type { Profile } from '../../../shared/contracts/profile.ts'

export interface ComposerKeyState {
  key: string
  shiftKey: boolean
  isComposing: boolean
}

export function composerKeyShouldSend(state: ComposerKeyState): boolean {
  return state.key === 'Enter' && !state.shiftKey && !state.isComposing
}

export function profileSkillSummary(profile: Profile): string {
  if (profile.skillIds === undefined) return '技能自动匹配'
  if (profile.skillIds.length === 0) return '不使用技能'
  return `${profile.skillIds.length} 个技能`
}
