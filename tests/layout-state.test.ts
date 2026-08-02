import { describe, expect, test } from 'bun:test'
import {
  resultPresentation,
  sidebarPresentation,
} from '../src/renderer/features/shell/layout-state.ts'

describe('响应式壳层状态', () => {
  test('结果区在 1180px 及以下改为覆盖层', () => {
    expect(resultPresentation(1500)).toBe('column')
    expect(resultPresentation(1181)).toBe('column')
    expect(resultPresentation(1180)).toBe('overlay')
  })

  test('侧栏按 820/640px 两档收缩和隐藏', () => {
    expect(sidebarPresentation(1180)).toBe('full')
    expect(sidebarPresentation(820)).toBe('compact')
    expect(sidebarPresentation(640)).toBe('hidden')
  })
})
