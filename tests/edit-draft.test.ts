import { describe, expect, test } from 'bun:test'
import {
  hasEditIntent,
  injectEditIntent,
  stripEditIntent,
} from '../src/renderer/features/results/edit-draft.ts'

describe('「让 Agent 改这份」草稿注入（A08）', () => {
  test('空草稿注入完整意图；已有草稿保留并追加', () => {
    expect(injectEditIntent('', 'C:\\a.md')).toContain('请修改这个文件：C:\\a.md')
    expect(injectEditIntent('先看下现在的实现', 'C:\\a.md')).toContain('先看下现在的实现')
    expect(injectEditIntent('先看下现在的实现', 'C:\\a.md')).toContain(
      '请修改这个文件：C:\\a.md',
    )
  })

  test('重复注入幂等', () => {
    const once = injectEditIntent('', 'C:\\a.md')
    expect(injectEditIntent(once, 'C:\\a.md')).toBe(once)
    expect(hasEditIntent(once, 'C:\\a.md')).toBe(true)
  })

  test('strip 只移除目标引用的行，保留用户其它草稿', () => {
    const draft = '我的笔记\n\n请修改这个文件：C:\\a.md'
    expect(stripEditIntent(draft, 'C:\\a.md')).toBe('我的笔记')
  })

  test('不同路径互不影响', () => {
    const draft = injectEditIntent('', 'C:\\a.md')
    expect(hasEditIntent(draft, 'C:\\b.md')).toBe(false)
    expect(stripEditIntent(draft, 'C:\\b.md')).toBe(draft)
  })
})
