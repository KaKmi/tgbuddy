import { Maximize2, Minus, X } from 'lucide-react'
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
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <WindowToolbar />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {resultsOpen && (
          <button
            type="button"
            data-testid="results-backdrop"
            aria-label="关闭结果区遮罩"
            onClick={onCloseResults}
            className="fixed inset-x-0 bottom-0 top-9 z-30 hidden cursor-default bg-black/20 backdrop-blur-[1px] max-[1180px]:block"
          />
        )}
        {children}
      </div>
    </div>
  )
}

function WindowToolbar() {
  return (
    <header
      data-testid="window-toolbar"
      className="window-drag flex h-9 shrink-0 items-center border-b bg-background/95 pl-3 text-[11.5px] text-muted-foreground"
    >
      <span className="font-medium tracking-[-.01em] text-foreground/80">TgBuddy</span>
      <span className="ml-2 text-muted-foreground/55">本地智能体</span>
      <div className="window-no-drag ml-auto flex h-full items-stretch">
        <WindowButton label="最小化" onClick={() => void window.tgbuddy.windowControls.minimize()}>
          <Minus size={14} strokeWidth={1.6} />
        </WindowButton>
        <WindowButton label="最大化或还原" onClick={() => void window.tgbuddy.windowControls.toggleMaximize()}>
          <Maximize2 size={12} strokeWidth={1.6} />
        </WindowButton>
        <WindowButton danger label="关闭窗口" onClick={() => void window.tgbuddy.windowControls.close()}>
          <X size={14} strokeWidth={1.6} />
        </WindowButton>
      </div>
    </header>
  )
}

function WindowButton({
  children,
  danger = false,
  label,
  onClick,
}: {
  children: ReactNode
  danger?: boolean
  label: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid w-11 place-items-center transition-colors ${
        danger
          ? 'hover:bg-red-500 hover:text-white'
          : 'hover:bg-foreground/[.07] hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
