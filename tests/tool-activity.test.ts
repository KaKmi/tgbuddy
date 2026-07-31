import { describe, expect, test } from 'bun:test'
import { buildToolResultMap } from '../src/renderer/App.tsx'
import {
  applyAgentEvent,
  emptyStreamState,
  type LocalEvent,
} from '../src/renderer/atoms/agent.ts'
import { previewToolText } from '../src/renderer/components/ToolCard.tsx'
import {
  createToolRunningTimers,
} from '../src/renderer/hooks/useGlobalAgentListeners.ts'
import type { SessionMessage } from '../src/shared/contracts/message.ts'

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

describe('工具调用四态', () => {
  test('tool start、running、success/error 和停止后交回历史状态', () => {
    const started = applyAgentEvent(emptyStreamState(), {
      type: 'tool_start',
      toolCallId: 'call-1',
      toolName: 'read',
      args: { path: 'README.md' },
    })
    expect(started.toolActivities[0]?.status).toBe('awaiting_permission')

    const running = applyAgentEvent(started, {
      type: 'tool_running',
      toolCallId: 'call-1',
    })
    expect(running.toolActivities[0]?.status).toBe('running')

    const succeeded = applyAgentEvent(running, {
      type: 'tool_end',
      toolCallId: 'call-1',
      isError: false,
      output: '读取完成',
    })
    expect(succeeded.toolActivities[0]?.status).toBe('success')
    expect(succeeded.toolActivities[0]?.result).toEqual({
      isError: false,
      text: '读取完成',
    })

    const failed = applyAgentEvent(started, {
      type: 'tool_end',
      toolCallId: 'call-1',
      isError: true,
      output: '文件不存在',
    })
    expect(failed.toolActivities[0]?.status).toBe('error')
    expect(failed.toolActivities[0]?.result?.text).toBe('文件不存在')

    const settled = applyAgentEvent(succeeded, {
      type: 'run_end',
      stopReason: 'aborted',
    })
    expect(settled.toolActivities).toEqual([])
  })

  test('授权在延迟窗口内到达时保持等待，免检工具才升级为 running', async () => {
    const events: Array<{ sessionId: string; event: LocalEvent }> = []
    const timers = createToolRunningTimers(
      (sessionId, event) => events.push({ sessionId, event }),
      10,
    )

    timers.start('session-1', 'call-awaiting')
    timers.cancel('call-awaiting')
    await wait(20)
    expect(events).toEqual([])

    timers.start('session-2', 'call-running')
    await wait(20)
    expect(events).toEqual([{
      sessionId: 'session-2',
      event: { type: 'tool_running', toolCallId: 'call-running' },
    }])
    timers.dispose()
  })

  test('历史 toolResult 重放为成功或失败卡，缺失结果保持 unknown', () => {
    const messages: SessionMessage[] = [
      {
        kind: 'kernel',
        id: 'result-1',
        createdAt: 2,
        message: {
          role: 'toolResult',
          toolCallId: 'call-success',
          toolName: 'read',
          content: [{ type: 'text', text: '历史输出' }],
          isError: false,
          timestamp: 2,
        },
      },
      {
        kind: 'kernel',
        id: 'result-2',
        createdAt: 3,
        message: {
          role: 'toolResult',
          toolCallId: 'call-error',
          toolName: 'read',
          content: [{ type: 'text', text: '历史错误' }],
          isError: true,
          timestamp: 3,
        },
      },
    ]

    const results = buildToolResultMap(messages)
    expect(results.get('call-success')).toEqual({
      isError: false,
      text: '历史输出',
    })
    expect(results.get('call-error')).toEqual({
      isError: true,
      text: '历史错误',
    })
    expect(results.has('call-interrupted')).toBe(false)
  })

  test('工具输出只展示八行预览', () => {
    const text = Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    const preview = previewToolText(text)

    expect(preview).toContain('第 8 行')
    expect(preview).not.toContain('第 9 行')
    expect(preview).toContain('其余 2 行暂不展示')
  })

  test('用户拒绝后 pi 补发的 tool_end 不覆盖 denied 状态', () => {
    const started = applyAgentEvent(emptyStreamState(), {
      type: 'tool_start',
      toolCallId: 'call-1',
      toolName: 'write',
      args: { path: 'm2-write.txt' },
    })
    const denied = applyAgentEvent(started, {
      type: 'tool_denied',
      toolCallId: 'call-1',
    })
    expect(denied.toolActivities[0]?.status).toBe('denied')

    const lateEnd = applyAgentEvent(denied, {
      type: 'tool_end',
      toolCallId: 'call-1',
      isError: true,
      output: '用户拒绝了授权',
    })
    expect(lateEnd.toolActivities[0]?.status).toBe('denied')
  })
})
