import { describe, expect, test } from 'bun:test'
import { createHumanInteractionRegistry } from '../../../src/runtime/pending/human-interaction-registry.ts'

describe('HumanInteractionRegistry', () => {
  test('同一 root 只激活队首，完成后推进下一项', () => {
    const registry = createHumanInteractionRegistry()
    const activated: string[] = []
    registry.register(entry('permission-1', 'permission', 'parent', () => activated.push('permission-1')))
    registry.register(entry('question-1', 'ask_user', 'child', () => activated.push('question-1'), 'task-1'))

    expect(activated).toEqual(['permission-1'])
    expect(registry.listPending('root-1').map((item) => item.active)).toEqual([true, false])
    expect(registry.attention('task-1')).toMatchObject({ kind: 'user', active: false })

    registry.complete('permission-1')
    expect(activated).toEqual(['permission-1', 'question-1'])
    expect(registry.attention('task-1')).toMatchObject({ kind: 'user', active: true })
  })

  test('每个 root 最多登记 8 个等待请求', () => {
    const registry = createHumanInteractionRegistry(2)
    registry.register(entry('a', 'permission', 'parent', () => {}))
    registry.register(entry('b', 'plan', 'parent', () => {}))
    expect(() => registry.register(entry('c', 'ask_user', 'parent', () => {}))).toThrow(/过多/)
  })
})

function entry(
  id: string,
  kind: 'permission' | 'plan' | 'ask_user',
  subjectId: string,
  activate: () => void,
  taskId?: string,
) {
  return {
    id,
    kind,
    source: {
      rootRunId: 'root-1',
      runId: subjectId,
      sessionId: subjectId,
      subjectId,
      ...(taskId ? { taskId } : {}),
    },
    payload: { id },
    activate,
  }
}
