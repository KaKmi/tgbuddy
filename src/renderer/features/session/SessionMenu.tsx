import { useState } from 'react'
import type { SessionMeta } from '../../../shared/contracts/session.ts'

/** U03：会话菜单动作（重命名/置顶/归档/删除），复用既有 SessionCommands。 */
export function SessionMenu({
  session,
  onChanged,
}: {
  session: SessionMeta
  onChanged(): Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      await onChanged()
    } catch (error) {
      console.error('[会话菜单] 操作失败：', error)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="会话菜单"
        data-testid={`session-menu-${session.id}`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        className="rounded-md px-1.5 text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
      >
        ⋯
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
            }}
          />
          <div className="absolute right-0 top-full z-20 mt-0.5 w-36 overflow-hidden rounded-lg bg-popover py-1 shadow-lg ring-1 ring-border">
            <MenuItem
              label={session.pinned ? '取消置顶' : '置顶'}
              onClick={() => run(() => update(session.id, { pinned: !session.pinned }))}
            />
            <MenuItem
              label={session.archived ? '取消归档' : '归档'}
              onClick={() => run(() => update(session.id, { archived: !session.archived }))}
            />
            <MenuItem
              label="重命名"
              onClick={() =>
                run(async () => {
                  const name = window.prompt('新名称', session.title ?? '')
                  if (name?.trim()) await update(session.id, { title: name.trim() })
                })
              }
            />
            <div className="my-1 h-px bg-white/5" />
            <MenuItem
              danger
              label="删除会话"
              onClick={() =>
                run(async () => {
                  if (window.confirm('删除该会话及其消息？')) {
                    await window.tgbuddy.session.delete(session.id)
                  }
                })
              }
            />
          </div>
        </>
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
