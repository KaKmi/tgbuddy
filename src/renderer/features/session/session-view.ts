import type { SessionMeta } from '../../../shared/contracts/session.ts'

export type NavigationIntent =
  | { kind: 'new-session' }
  | { kind: 'switch-session'; sessionId: string }
  | { kind: 'switch-workspace'; workspaceId: string }

export function hasUnsavedDraft(text: string, attachments: readonly unknown[]): boolean {
  return text.trim().length > 0 || attachments.length > 0
}

export function filterSessions(sessions: SessionMeta[], query: string): SessionMeta[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return sessions
  return sessions.filter((session) =>
    [session.title, session.lastActivity, session.statusDetail]
      .some((value) => value?.toLocaleLowerCase().includes(normalized)),
  )
}

export function groupSessions(
  sessions: SessionMeta[],
  now = Date.now(),
): { title: string; items: SessionMeta[] }[] {
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
