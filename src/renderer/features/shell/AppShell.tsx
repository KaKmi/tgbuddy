import type { ReactNode } from 'react'

/** TgBuddy 的稳定三栏外壳；具体栏内容由各 feature 自己维护。 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="app-shell"
      className="flex h-screen min-h-0 overflow-hidden bg-background text-foreground"
    >
      {children}
    </div>
  )
}
