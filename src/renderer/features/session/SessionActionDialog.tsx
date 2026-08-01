import { useEffect, useRef } from 'react'

interface SessionActionDialogProps {
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  input?: {
    label: string
    value: string
    onChange(value: string): void
  }
  onCancel(): void
  onConfirm(): void
}

/** 会话与草稿动作共用的轻量模态，替代阻塞式浏览器弹窗。 */
export function SessionActionDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  danger,
  busy,
  input,
  onCancel,
  onConfirm,
}: SessionActionDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ;(inputRef.current ?? cancelRef.current)?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onCancel])

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/20 px-4 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[380px] rounded-2xl border bg-popover p-4 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        {input && (
          <input
            ref={inputRef}
            aria-label={input.label}
            value={input.value}
            onChange={(event) => input.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && input.value.trim() && !busy) onConfirm()
            }}
            className="mt-4 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy || Boolean(input && !input.value.trim())}
            onClick={onConfirm}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
              danger
                ? 'bg-status-error/15 text-status-error hover:bg-status-error/25'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
