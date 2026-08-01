import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../../shared/contracts/session.ts'
import { SessionActionDialog } from './SessionActionDialog.tsx'

type PendingAction = 'rename' | 'delete'

/** 会话菜单动作（重命名/置顶/归档/删除），复用既有 SessionCommands。 */
export function SessionMenu({
  session,
  onChanged,
}: {
  session: SessionMeta
  onChanged(): Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>()
  const [name, setName] = useState(session.title)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function closeMenu(restoreFocus = true) {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      await onChanged()
      setPendingAction(undefined)
    } catch (error) {
      console.error('[会话菜单] 操作失败：', error)
    } finally {
      setBusy(false)
      closeMenu(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="会话菜单"
        aria-expanded={open}
        data-testid={`session-menu-${session.id}`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭会话菜单"
            className="fixed inset-0 z-10 cursor-default"
            onClick={(event) => {
              event.stopPropagation()
              closeMenu()
            }}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border bg-popover py-1 shadow-xl"
          >
            <MenuItem
              label={session.pinned ? '取消置顶' : '置顶'}
              onClick={() => void run(() => update(session.id, { pinned: !session.pinned }))}
            />
            <MenuItem
              label={session.archived ? '取消归档' : '归档'}
              onClick={() => void run(() => update(session.id, { archived: !session.archived }))}
            />
            <MenuItem
              label="重命名"
              onClick={() => {
                setName(session.title)
                closeMenu(false)
                setPendingAction('rename')
              }}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              danger
              label="删除会话"
              onClick={() => {
                closeMenu(false)
                setPendingAction('delete')
              }}
            />
          </div>
        </>
      )}

      {pendingAction === 'rename' && (
        <SessionActionDialog
          title="重命名会话"
          description="名称会同时显示在侧栏和会话标题栏。"
          confirmLabel="保存"
          busy={busy}
          input={{ label: '会话名称', value: name, onChange: setName }}
          onCancel={() => {
            setPendingAction(undefined)
            triggerRef.current?.focus()
          }}
          onConfirm={() => void run(() => update(session.id, { title: name.trim() }))}
        />
      )}
      {pendingAction === 'delete' && (
        <SessionActionDialog
          title="删除会话"
          description={`“${session.title}”及其消息会被删除，此操作无法撤销。`}
          confirmLabel="删除"
          danger
          busy={busy}
          onCancel={() => {
            setPendingAction(undefined)
            triggerRef.current?.focus()
          }}
          onConfirm={() => void run(() => window.tgbuddy.session.delete(session.id))}
        />
      )}
    </div>
  )
}

function update(id: string, patch: Partial<SessionMeta>) {
  return window.tgbuddy.session.updateMeta(id, patch)
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick(): void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 ${
        danger ? 'text-status-error' : 'text-foreground/80'
      }`}
    >
      {label}
    </button>
  )
}
