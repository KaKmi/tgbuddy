import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  applyTheme,
  readTheme,
  toggleTheme,
  writeTheme,
  type ThemeName,
} from './theme-state.ts'

export function useTheme(): {
  theme: ThemeName
  toggle: () => void
} {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const initial = readTheme(window.localStorage)
    applyTheme(document.documentElement, initial)
    return initial
  })

  useEffect(() => {
    applyTheme(document.documentElement, theme)
    writeTheme(window.localStorage, theme)
  }, [theme])

  return {
    theme,
    toggle: () => setTheme((current) => toggleTheme(current)),
  }
}

export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: ThemeName
  onToggle: () => void
}) {
  const nextLabel = theme === 'light' ? '切换到深色主题' : '切换到明亮主题'
  return (
    <button
      type="button"
      aria-label={nextLabel}
      title={nextLabel}
      onClick={onToggle}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  )
}
