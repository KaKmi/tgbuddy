import { describe, expect, test } from 'bun:test'
import { createDelegationService } from '../../../src/runtime/delegation/delegation-service.ts'
import { MemoryRunRepository } from '../../../src/runtime/runs/run-repository.ts'
import type { RunCoordinator } from '../../../src/runtime/runs/run-coordinator.ts'
import type { StreamFrame } from '../../../src/shared/contracts/events.ts'

function assistantFrame(sessionId: string, text: string): StreamFrame {
  return {
    sessionId,
    runId: 1,
    payload: {
      channel: 'agent',
      event: {
        type: 'message_end',
        message: {
          kind: 'kernel',
          id: `m-${text.length}`,
          createdAt: 1,
          message: {
            role: 'assistant',
            timestamp: '2026-01-01T00:00:00.000Z',
            content: [{ type: 'text', text }],
            stopReason: 'stop',
          },
        },
      },
    },
  }
}

function harness(options: {
  childCount?: number
  failCreate?: boolean
  frames?: StreamFrame[]
  runningRootRunId?: string
}) {
  const created: string[] = []
  const started: Array<{ sessionId: string; text: string; lineage?: unknown }> = []
  const sessions = {
    create: async () => {
      if (options.failCreate) throw new Error('创建失败')
      const id = `child-${created.length}`
      created.push(id)
      return { id }
    },
    list: () => [],
    updateMeta: () => undefined,
    delete: async () => {},
  }
  const runs = new MemoryRunRepository()
  if (options.runningRootRunId) {
    runs.create({
      id: options.runningRootRunId,
      sessionId: 'parent-1',
      rootRunId: options.runningRootRunId,
      status: 'running',
      createdAt: 1,
    })
  }
  const coordinator: RunCoordinator = {
    start: async (input, emit) => {
      started.push({ sessionId: input.sessionId, text: input.text, lineage: input.lineage })
      for (const frame of options.frames ?? []) emit(frame)
    },
    stop: () => {},
    isRunning: () => false,
    list: () => [],
    dispose: async () => {},
  }
  const service = createDelegationService({
    sessions: sessions as never,
    coordinator,
    runs,
    createId: () => 'child-0',
    now: () => 1,
  })
  return { service, created, started }
}

describe('DelegationService（D02）', () => {
  test('成功：创建 child 会话、启动带 lineage 的 run、返回摘要', async () => {
    const { service, created, started } = harness({
      runningRootRunId: 'root-1',
      frames: [assistantFrame('child-0', '探索完成：找到 3 个候选文件')],
    })

    const result = await service.delegate({
      parentSessionId: 'parent-1',
      workspaceId: 'ws-1',
      task: '探索一下',
      parentToolCallId: 'tool-1',
    })

    expect(result.ok).toBe(true)
    expect(result.text).toContain('探索完成：找到 3 个候选文件')
    expect(created).toEqual(['child-0'])
    expect(started[0]).toMatchObject({
      text: '探索一下',
      lineage: {
        rootRunId: 'root-1',
        parentToolCallId: 'tool-1',
        workspaceId: 'ws-1',
      },
    })
  })

  test('达到 child 上限时拒绝，不创建会话不启动 run', async () => {
    const { service, created, started } = harness({
      runningRootRunId: 'root-1',
      frames: [assistantFrame('child-0', '完成')],
    })
    // 预置 2 个 child（模拟本 root 已委派过两次）
    const first = await service.delegate({
      parentSessionId: 'parent-1',
      workspaceId: 'ws-1',
      task: 'a',
      parentToolCallId: 't1',
    })
    const second = await service.delegate({
      parentSessionId: 'parent-1',
      workspaceId: 'ws-1',
      task: 'b',
      parentToolCallId: 't2',
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    const third = await service.delegate({
      parentSessionId: 'parent-1',
      workspaceId: 'ws-1',
      task: 'c',
      parentToolCallId: 't3',
    })
    expect(third.ok).toBe(false)
    expect(third.text).toContain('最多委派 2 个')
    expect(created).toHaveLength(2)
    expect(started).toHaveLength(2)
  })

  test('child 会话创建失败给出可操作原因', async () => {
    const { service } = harness({ failCreate: true, runningRootRunId: 'root-1' })
    const result = await service.delegate({
      parentSessionId: 'parent-1',
      workspaceId: 'ws-1',
      task: 'x',
      parentToolCallId: 't1',
    })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('子智能体会话创建失败')
  })

  test('child 无输出时返回明确失败', async () => {
    const { service } = harness({ runningRootRunId: 'root-1', frames: [] })
    const result = await service.delegate({
      parentSessionId: 'parent-1',
      workspaceId: 'ws-1',
      task: 'x',
      parentToolCallId: 't1',
    })
    expect(result).toEqual({ ok: false, text: '子智能体没有返回结果' })
  })
})
