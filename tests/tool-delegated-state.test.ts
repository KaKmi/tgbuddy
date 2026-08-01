import { describe, expect, test } from 'bun:test'
import { buildToolResultMap } from '../src/renderer/App.tsx'
import type { SessionMessage } from '../src/shared/types/message.ts'

function toolResultMessage(
  toolCallId: string,
  details?: Record<string, unknown>,
): SessionMessage {
  return {
    kind: 'kernel',
    id: `id-${toolCallId}`,
    createdAt: 1,
    message: {
      role: 'toolResult',
      timestamp: '2026-01-01T00:00:00.000Z',
      toolCallId,
      content: [{ type: 'text', text: '子智能体结果：完成' }],
      isError: false,
      ...(details ? { details } : {}),
    },
  }
}

describe('委派工具结果标识（D04）', () => {
  test('delegate_to_agent 的 details.delegated=true 标记为子智能体组', () => {
    const map = buildToolResultMap([
      toolResultMessage('t1', { delegated: true, action: 'execute' }),
      toolResultMessage('t2'),
    ])

    expect(map.get('t1')?.delegated).toBe(true)
    expect(map.get('t1')?.text).toContain('子智能体结果')
    expect(map.get('t2')?.delegated).toBeUndefined()
  })
})
