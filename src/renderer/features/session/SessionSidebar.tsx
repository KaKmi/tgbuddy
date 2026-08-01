import { Activity, Folder, HardDrive, Pin, Plus, Search, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../../shared/contracts/session.ts'
import type {
  Workspace,
  WorkspaceMountResolution,
} from '../../../shared/contracts/workspace.ts'
import { ThemeToggle } from '../theme/ThemeToggle.tsx'
import type { ThemeName } from '../theme/theme-state.ts'
import { SessionActions } from './SessionActions.tsx'
import { filterSessions, groupSessions } from './session-view.ts'

interface SessionSidebarProps {
  sessions: SessionMeta[]
  currentSessionId: string | null
  workspaces: Workspace[]
  currentWorkspace?: Workspace
  mountStatus?: WorkspaceMountResolution
  theme: ThemeName
  onToggleTheme(): void
  onNewSession(): Promise<void>
  onSelectSession(sessionId: string): Promise<void>
  onSelectWorkspace(workspaceId: string): Promise<void>
  onAddWorkspace(): Promise<void>
  onOpenSettings(): void
  onSessionsChanged(): Promise<void>
}

/** Workspace、会话目录与全局入口的唯一 Renderer owner。 */
export function SessionSidebar({
  sessions,
  currentSessionId,
  workspaces,
  currentWorkspace,
  mountStatus,
  theme,
  onToggleTheme,
  onNewSession,
  onSelectSession,
  onSelectWorkspace,
  onAddWorkspace,
  onOpenSettings,
  onSessionsChanged,
}: SessionSidebarProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [sessionQuery, setSessionQuery] = useState('')
  const [preview, setPreview] = useState<{
    session: SessionMeta
    left: number
    top: number
  }>()
  const previewTimer = useRef<ReturnType<typeof setTimeout>>()
  const filteredSessions = filterSessions(sessions, sessionQuery)

  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
  }, [])

  function schedulePreview(session: SessionMeta, element: HTMLElement): void {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    const rect = element.getBoundingClientRect()
    previewTimer.current = setTimeout(() => {
      setPreview({
        session,
        left: rect.right + 8,
        top: Math.min(rect.top, window.innerHeight - 150),
      })
    }, 320)
  }

  function clearPreview(): void {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    setPreview(undefined)
  }

  return (
    <aside
      data-testid="app-sidebar"
      className="flex w-[252px] shrink-0 flex-col gap-2.5 border-r bg-background px-2.5 pb-2.5 pt-3 max-[820px]:w-[218px] max-[640px]:hidden"
    >
      <div data-testid="app-brand" className="flex items-center gap-2 px-1 pb-0.5 pt-0.5">
        <span className="grid h-[23px] w-[23px] place-items-center rounded-[7px] bg-primary text-[11px] font-bold tracking-[-.02em] text-primary-foreground">
          T
        </span>
        <span className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-.01em]">TgBuddy</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            data-testid="settings-open"
            aria-label="打开设置"
            onClick={onOpenSettings}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.7} />
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>

      <div>
        <div className="relative">
          <button
            type="button"
            data-testid="workspace-picker"
            aria-expanded={workspaceOpen}
            onClick={() => setWorkspaceOpen((open) => !open)}
            className="flex min-h-[52px] w-full items-center gap-[9px] rounded-[10px] bg-card/70 px-[9px] py-[7px] text-left transition-colors hover:bg-card hover:ring-1 hover:ring-border"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-status-running/10 text-status-running">
              <HardDrive className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="block truncate text-[12.5px] font-semibold text-foreground">
                {currentWorkspace?.name ?? '选择工作区'}
              </span>
              <span
                data-testid={mountStatus?.ok === false ? 'workspace-mount-error' : undefined}
                className={`block truncate font-mono text-[10.5px] leading-[1.35] ${
                  mountStatus?.ok === false ? 'text-status-error' : 'text-muted-foreground'
                }`}
              >
                {mountStatus?.ok === false
                  ? '目录不可用 · 重新选择文件夹'
                  : currentWorkspace?.mount?.path ?? '还没有工作区'}
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">▾</span>
          </button>

          {workspaceOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border bg-popover p-1.5 shadow-2xl">
              <div className="px-2 py-1 text-[10.5px] tracking-wide text-muted-foreground">
                工作区
              </div>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  data-testid="workspace-option"
                  onClick={() => {
                    void onSelectWorkspace(workspace.id).then(() => setWorkspaceOpen(false))
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                >
                  <span className="w-3 shrink-0 text-center text-xs text-status-info">
                    {workspace.id === currentWorkspace?.id ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-foreground">
                      {workspace.name}
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                      {workspace.mount?.path}
                    </span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                data-testid="workspace-add"
                onClick={() => void onAddWorkspace().then(() => setWorkspaceOpen(false))}
                className="mt-1 flex w-full items-center gap-2 border-t px-2 pb-1 pt-2 text-left text-xs text-status-info transition-colors hover:bg-accent/60"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
                选择其他文件夹…
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-label="+ 新会话"
          onClick={() => void onNewSession()}
          className="flex min-h-9 w-full items-center gap-2 rounded-[10px] border border-dashed border-border px-2.5 text-left text-[13px] text-foreground/85 transition-colors hover:border-muted-foreground hover:bg-card"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />
          新会话
          <kbd className="ml-auto font-mono text-[10px] text-muted-foreground/65">Ctrl N</kbd>
        </button>
        <label className="flex min-h-9 w-full items-center gap-2 rounded-[10px] bg-card/60 px-2.5 text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))] focus-within:bg-card focus-within:shadow-[inset_0_0_0_1px_hsl(var(--border)),0_0_0_3px_hsl(var(--ring)/.12)]">
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <input
            value={sessionQuery}
            onChange={(event) => setSessionQuery(event.target.value)}
            placeholder="搜索会话与产物"
            data-testid="session-search"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </label>
      </div>

      <div className="-mx-0.5 min-h-0 flex-1 overflow-y-auto px-0.5 pb-3.5">
        {groupSessions(filteredSessions).map((group) => (
          <section key={group.title} className="mt-3 flex flex-col gap-0.5">
            <div className="px-2 py-1 text-[10.5px] font-semibold tracking-[.07em] text-muted-foreground/70">
              {group.title}
            </div>
            {group.items.map((session) => (
              <div
                key={session.id}
                className="group relative flex items-center"
                onMouseEnter={(event) => schedulePreview(session, event.currentTarget)}
                onMouseLeave={clearPreview}
              >
                <button
                  type="button"
                  data-testid="session-item"
                  data-session-id={session.id}
                  aria-current={session.id === currentSessionId ? 'true' : undefined}
                  onClick={() => void onSelectSession(session.id)}
                  className={`block w-full rounded-[10px] px-[9px] py-[9px] text-left transition-colors ${
                    session.id === currentSessionId ? 'bg-accent shadow-[inset_0_0_0_1px_hsl(var(--border))]' : 'hover:bg-accent/75'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-1.5 transition-[padding] group-hover:pr-[74px] group-focus-within:pr-[74px]">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {session.title}
                    </span>
                    {session.pinned && (
                      <Pin className="h-[11px] w-[11px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
                    )}
                    <span className="shrink-0 text-[10.5px] text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                      {relativeTime(session.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {session.status === 'running' && (
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-status-warning" />
                    )}
                    <span
                      className={`truncate pl-px text-[10.8px] ${
                        session.status === 'failed' ? 'text-status-error' : 'text-muted-foreground'
                      }`}
                    >
                      {sessionSubtitle(session)}
                    </span>
                  </div>
                </button>
                <SessionActions
                  session={session}
                  onChanged={onSessionsChanged}
                  onInteract={clearPreview}
                />
              </div>
            ))}
          </section>
        ))}
        {sessions.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">还没有会话</p>
        )}
      </div>

      {preview && (
        <div
          data-testid="session-preview"
          className="pointer-events-none fixed z-[55] w-[270px] rounded-xl border bg-popover p-3 text-popover-foreground shadow-[0_18px_48px_rgba(0,0,0,.22)]"
          style={{ left: preview.left, top: preview.top }}
        >
          <div className="flex items-baseline gap-3">
            <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {preview.session.title}
            </strong>
            <span className="shrink-0 text-[10.5px] text-muted-foreground">
              {relativeTime(preview.session.updatedAt)}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Folder size={14} strokeWidth={1.7} />
            <span className="truncate">{workspaceName(preview.session, workspaces)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Activity size={14} strokeWidth={1.7} />
            <span className="truncate">{sessionSubtitle(preview.session)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 px-[7px] pb-0.5 pt-2 text-[10.5px]">
        <div
          data-testid="local-mode"
          className="mr-auto inline-flex min-w-0 items-center gap-1.5 px-1.5 text-[10.5px] text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
          本地模式
        </div>
      </div>
    </aside>
  )
}

function workspaceName(session: SessionMeta, workspaces: Workspace[]): string {
  const workspace = workspaces.find((item) => item.id === session.workspaceId)
  return workspace?.name ?? '当前工作区'
}

function sessionSubtitle(session: SessionMeta): string {
  if (session.status === 'running') return session.lastActivity ?? '进行中…'
  if (session.status === 'interrupted') return `已中断 · ${session.statusDetail ?? '可继续发送'}`
  if (session.status === 'failed') return `失败 · ${session.statusDetail ?? '未知原因'}`
  if (session.artifactCount) return `已完成 · ${session.artifactCount} 个产物`
  if (session.status === 'done') return '已完成'
  return '未开始'
}

function relativeTime(timestamp: number): string {
  const difference = Date.now() - timestamp
  if (difference < 60_000) return '刚刚'
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  if (difference < 7 * 86_400_000) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]!
  }
  return `${date.getMonth() + 1}-${date.getDate()}`
}
