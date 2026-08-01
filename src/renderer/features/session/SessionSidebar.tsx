import { HardDrive, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import type { SessionMeta } from '../../../shared/contracts/session.ts'
import type {
  Workspace,
  WorkspaceMountResolution,
} from '../../../shared/contracts/workspace.ts'
import { ThemeToggle } from '../theme/ThemeToggle.tsx'
import type { ThemeName } from '../theme/theme-state.ts'
import { SessionMenu } from './SessionMenu.tsx'

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
  const filteredSessions = sessionQuery.trim()
    ? sessions.filter((session) =>
        session.title.toLowerCase().includes(sessionQuery.trim().toLowerCase()),
      )
    : sessions

  return (
    <aside
      data-testid="app-sidebar"
      className="flex w-[252px] shrink-0 flex-col border-r bg-background max-[820px]:w-[218px] max-[640px]:hidden"
    >
      <div data-testid="app-brand" className="flex h-12 items-center gap-2.5 border-b px-3">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-primary text-[12px] font-semibold text-primary-foreground shadow-sm">
          T
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold tracking-[-0.01em]">TgBuddy</span>
          <span className="block text-[9px] tracking-[0.12em] text-muted-foreground">LOCAL AGENT</span>
        </span>
      </div>

      <div className="border-b p-3">
        <div className="relative">
          <button
            type="button"
            data-testid="workspace-picker"
            aria-expanded={workspaceOpen}
            onClick={() => setWorkspaceOpen((open) => !open)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-status-info" strokeWidth={1.7} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {currentWorkspace?.name ?? '选择工作区'}
              </span>
              <span
                data-testid={mountStatus?.ok === false ? 'workspace-mount-error' : undefined}
                className={`block truncate font-mono text-[10.5px] ${
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

      <div className="p-3 pb-2">
        <button
          type="button"
          aria-label="+ 新会话"
          onClick={() => void onNewSession()}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />
          新会话
        </button>
        <input
          value={sessionQuery}
          onChange={(event) => setSessionQuery(event.target.value)}
          placeholder="搜索会话…"
          data-testid="session-search"
          className="mt-2 w-full rounded-lg bg-accent/45 px-2.5 py-1.5 text-xs text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/60 focus:ring-ring/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groupSessions(filteredSessions).map((group) => (
          <section key={group.title} className="mb-3">
            <div className="px-3 pb-1 pt-2 text-[10.5px] text-muted-foreground">
              {group.title}
            </div>
            {group.items.map((session) => (
              <div key={session.id} className="group relative mb-0.5 flex items-center">
                <button
                  type="button"
                  data-testid="session-item"
                  onClick={() => void onSelectSession(session.id)}
                  className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    session.id === currentSessionId ? 'bg-accent' : 'hover:bg-accent/60'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {session.title}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      {relativeTime(session.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {session.status === 'running' && (
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-status-warning" />
                    )}
                    <span
                      className={`truncate text-[11px] ${
                        session.status === 'failed' ? 'text-status-error' : 'text-muted-foreground'
                      }`}
                    >
                      {sessionSubtitle(session)}
                    </span>
                  </div>
                </button>
                <SessionMenu session={session} onChanged={onSessionsChanged} />
              </div>
            ))}
          </section>
        ))}
        {sessions.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">还没有会话</p>
        )}
      </div>

      <div className="flex items-center gap-1 border-t px-2 py-2">
        <div
          data-testid="local-mode"
          className="mr-auto inline-flex min-w-0 items-center gap-1.5 px-1.5 text-[10.5px] text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
          本地模式
        </div>
        <button
          type="button"
          data-testid="settings-open"
          aria-label="打开设置"
          onClick={onOpenSettings}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </aside>
  )
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

function groupSessions(sessions: SessionMeta[]): { title: string; items: SessionMeta[] }[] {
  const now = Date.now()
  const buckets: Record<string, SessionMeta[]> = {
    置顶: [],
    今天: [],
    '更早 · 7 天内': [],
    更早: [],
  }
  for (const session of sessions) {
    if (session.archived) continue
    if (session.pinned) {
      buckets['置顶']!.push(session)
      continue
    }
    const sameDay = new Date(session.updatedAt).toDateString() === new Date(now).toDateString()
    if (sameDay) buckets['今天']!.push(session)
    else if (now - session.updatedAt < 7 * 86_400_000) buckets['更早 · 7 天内']!.push(session)
    else buckets['更早']!.push(session)
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => ({ title, items }))
}
