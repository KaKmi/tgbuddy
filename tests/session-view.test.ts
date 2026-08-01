import { describe, expect, test } from 'bun:test'
import type { SessionMeta } from '../src/shared/contracts/session.ts'
import {
  filterSessions,
  groupSessions,
  hasUnsavedDraft,
} from '../src/renderer/features/session/session-view.ts'

const now = new Date('2026-08-01T12:00:00+08:00').getTime()

function session(patch: Partial<SessionMeta>): SessionMeta {
  return {
    id: patch.id ?? crypto.randomUUID(),
    title: patch.title ?? '未命名会话',
    createdAt: patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    ...patch,
  }
}

describe('会话侧栏视图模型', () => {
  test('搜索同时匹配标题和活动摘要', () => {
    const sessions = [
      session({ id: 'risk', title: 'Q2 风控', lastActivity: '正在写 reports/q2.md' }),
      session({ id: 'build', title: '构建发布', lastActivity: '运行测试' }),
    ]
    expect(filterSessions(sessions, '风控').map((item) => item.id)).toEqual(['risk'])
    expect(filterSessions(sessions, 'reports').map((item) => item.id)).toEqual(['risk'])
    expect(filterSessions(sessions, '不存在')).toEqual([])
  })

  test('置顶优先于 Today 分组', () => {
    const groups = groupSessions([
      session({ id: 'today', updatedAt: now }),
      session({ id: 'pin', pinned: true, updatedAt: now }),
    ], now)
    expect(groups.map((group) => group.title)).toEqual(['置顶', '今天'])
    expect(groups[0]?.items[0]?.id).toBe('pin')
  })

  test('纯空白不是草稿，正文或附件任一存在即保护', () => {
    expect(hasUnsavedDraft('  \n ', [])).toBe(false)
    expect(hasUnsavedDraft('待发送', [])).toBe(true)
    expect(hasUnsavedDraft('', [{ id: 'blob' }])).toBe(true)
  })
})
