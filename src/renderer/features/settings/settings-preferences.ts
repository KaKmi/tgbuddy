import type { PermissionMode } from '../../../shared/contracts/permission.ts'

export const SETTINGS_PREFERENCES_KEY = 'tgbuddy-settings'

export interface SettingsPreferences {
  restoreOnLaunch: boolean
  defaultPermissionMode: PermissionMode
  primaryModel: string
  childModel: string
  compactionModel: string
}

export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const DEFAULT_SETTINGS_PREFERENCES: SettingsPreferences = {
  restoreOnLaunch: true,
  defaultPermissionMode: 'auto',
  primaryModel: '',
  childModel: 'follow',
  compactionModel: 'follow',
}

export function readSettingsPreferences(
  storage: Pick<SettingsStorage, 'getItem'>,
): SettingsPreferences {
  const raw = storage.getItem(SETTINGS_PREFERENCES_KEY)
  if (!raw) return DEFAULT_SETTINGS_PREFERENCES

  try {
    const parsed = JSON.parse(raw) as Partial<SettingsPreferences>
    return {
      restoreOnLaunch:
        typeof parsed.restoreOnLaunch === 'boolean'
          ? parsed.restoreOnLaunch
          : DEFAULT_SETTINGS_PREFERENCES.restoreOnLaunch,
      defaultPermissionMode: isPermissionMode(parsed.defaultPermissionMode)
        ? parsed.defaultPermissionMode
        : DEFAULT_SETTINGS_PREFERENCES.defaultPermissionMode,
      primaryModel:
        typeof parsed.primaryModel === 'string' ? parsed.primaryModel : '',
      childModel:
        typeof parsed.childModel === 'string' ? parsed.childModel : 'follow',
      compactionModel:
        typeof parsed.compactionModel === 'string'
          ? parsed.compactionModel
          : 'follow',
    }
  } catch {
    return DEFAULT_SETTINGS_PREFERENCES
  }
}

export function writeSettingsPreferences(
  storage: Pick<SettingsStorage, 'setItem'>,
  preferences: SettingsPreferences,
): void {
  storage.setItem(SETTINGS_PREFERENCES_KEY, JSON.stringify(preferences))
}

export function parseModelPreference(
  value: string,
): { channelId: string; modelId: string } | undefined {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return undefined
  return {
    channelId: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  }
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'auto' || value === 'plan' || value === 'bypass'
}
