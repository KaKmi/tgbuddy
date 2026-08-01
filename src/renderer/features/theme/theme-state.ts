export const THEME_STORAGE_KEY = 'tgbuddy-theme'

export type ThemeName = 'light' | 'dark'

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ThemeRoot {
  classList: { remove(name: string): void }
  dataset: Record<string, string | undefined>
}

export function readTheme(storage: Pick<ThemeStorage, 'getItem'>): ThemeName {
  return storage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
}

export function writeTheme(
  storage: Pick<ThemeStorage, 'setItem'>,
  theme: ThemeName,
): void {
  storage.setItem(THEME_STORAGE_KEY, theme)
}

export function toggleTheme(theme: ThemeName): ThemeName {
  return theme === 'light' ? 'dark' : 'light'
}

export function applyTheme(root: ThemeRoot, theme: ThemeName): void {
  root.classList.remove('dark')
  root.dataset.theme = theme
}
