import { Archive, Pin, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SessionMeta } from '../../../shared/contracts/session.ts'
import { SessionActionDialog } from './SessionActionDialog.tsx'

type SessionAction = 'pin' | 'archive' | 'delete'

/** 会话行悬停操作：保持常态安静，只在 hover / keyboard focus 时显示。 */
export function SessionActions({
  session,
  onChanged,
  onInteract,
}: {
  session: SessionMeta
  onChanged(): Promise<void>
  onInteract?(): void
}) {
  const [busyAction, setBusyAction] = useState<SessionAction>()
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function run(action: SessionAction, task: () => Promise<void>): Promise<void> {
    if (busyAction) return
    setBusyAction(action)
    try {
      await task()
      await onChanged()
      setConfirmDelete(false)
    } catch (error) {
      console.error('[会话操作] 执行失败：', error)
    } finally {
      setBusyAction(undefined)
    }
  }

  return (
    <>
      <div
        data-testid={`session-actions-${session.id}`}
        className="pointer-events-none absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-lg bg-accent/95 p-0.5 opacity-0 shadow-[0_1px_4px_rgba(0,0,0,.08)] backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        onPointerDown={onInteract}
      >
        <ActionButton
          label={session.pinned ? '取消置顶' : '置顶'}
          disabled={Boolean(busyAction)}
          onClick={() => void run('pin', () => update(session.id, { pinned: !session.pinned }))}
        >
          <Pin className={`h-3.5 w-3.5 ${session.pinned ? 'fill-current' : ''}`} strokeWidth={1.7} />
        </ActionButton>
        <ActionButton
          label="删除会话"
          danger
          disabled={Boolean(busyAction)}
          onClick={() => {
            onInteract?.()
            setConfirmDelete(true)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
        </ActionButton>
        <ActionButton
          label={session.archived ? '取消归档' : '归档'}
          disabled={Boolean(busyAction)}
          onClick={() => void run('archive', () => update(session.id, { archived: !session.archived }))}
        >
          <Archive className="h-3.5 w-3.5" strokeWidth={1.7} />
        </ActionButton>
      </div>

      {confirmDelete && (
        <SessionActionDialog
          title="删除会话"
          description={`“${session.title}”及其消息会被删除，此操作无法撤销。`}
          confirmLabel="删除"
          danger
          busy={busyAction === 'delete'}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void run('delete', () => window.tgbuddy.session.delete(session.id))}
        />
      )}
    </>
  )
}

function ActionButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  disabled: boolean
  onClick(): void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        danger
          ? 'text-muted-foreground hover:bg-status-error/10 hover:text-status-error'
          : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function update(id: string, patch: Partial<SessionMeta>): Promise<void> {
  return window.tgbuddy.session.updateMeta(id, patch)
}
