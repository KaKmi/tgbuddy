import { describe, expect, test } from 'bun:test'
import { MemoryAttachmentRepository } from '../../../src/runtime/attachments/attachment-repository.ts'
import type { AttachmentRef } from '../../../src/shared/contracts/attachment.ts'

function ref(id: string, name = `${id}.png`): AttachmentRef {
  return {
    id,
    name,
    size: 4,
    mime: 'image/png',
    blob: { hash: `hash-${id}`, size: 4, mime: 'image/png' },
  }
}

describe('AttachmentRepository（A02）', () => {
  test('save 后 byMessage 按 (sessionId, entryId) 还原附件 ref', () => {
    const repo = new MemoryAttachmentRepository()
    repo.save('session-1', 'entry-1', [ref('a1'), ref('a2')])
    repo.save('session-1', 'entry-2', [ref('b1')])

    expect(repo.byMessage('session-1', 'entry-1').map((item) => item.id)).toEqual([
      'a1',
      'a2',
    ])
    expect(repo.byMessage('session-1', 'entry-2').map((item) => item.id)).toEqual(['b1'])
    expect(repo.byMessage('session-1', 'entry-3')).toEqual([])
    expect(repo.byMessage('session-2', 'entry-1')).toEqual([])
  })

  test('同一消息重复 save 幂等覆盖（重发/续接场景）', () => {
    const repo = new MemoryAttachmentRepository()
    repo.save('session-1', 'entry-1', [ref('a1')])
    repo.save('session-1', 'entry-1', [ref('a1', '改名.png')])

    expect(repo.byMessage('session-1', 'entry-1')[0]?.name).toBe('改名.png')
  })

  test('deleteSession 只清理目标会话，其他会话不受影响', () => {
    const repo = new MemoryAttachmentRepository()
    repo.save('session-1', 'entry-1', [ref('a1')])
    repo.save('session-2', 'entry-1', [ref('b1')])

    repo.deleteSession('session-1')

    expect(repo.byMessage('session-1', 'entry-1')).toEqual([])
    expect(repo.byMessage('session-2', 'entry-1')).toHaveLength(1)
  })
})
