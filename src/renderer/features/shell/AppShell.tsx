import { useEffect, type ReactNode } from 'react'

/** TgBuddy 的稳定三栏外壳；具体栏内容由各 feature 自己维护。 */
export function AppShell({
  children,
  resultsOpen,
  onCloseResults,
}: {
  children: ReactNode
  resultsOpen: boolean
  onCloseResults(): void
}) {
  useEffect(() => {
    if (!resultsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseResults()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCloseResults, resultsOpen])

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen min-h-0 overflow-hidden bg-background text-foreground"
    >
      {resultsOpen && (
        <button
          type="button"
          data-testid="results-backdrop"
          aria-label="关闭结果区遮罩"
          onClick={onCloseResults}
          className="fixed inset-0 z-30 hidden cursor-default bg-black/20 backdrop-blur-[1px] max-[1180px]:block"
        />
      )}
      {children}
    </div>
  )
}
