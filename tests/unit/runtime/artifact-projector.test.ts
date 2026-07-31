import { describe, expect, test } from 'bun:test'
import {
  projectArtifact,
  PRODUCING_TOOLS,
} from '../../../src/runtime/artifacts/artifact-projector.ts'
import { MemoryArtifactRepository } from '../../../src/runtime/artifacts/artifact-repository.ts'

function project(input: {
  toolName?: string
  args?: Record<string, unknown>
  isError?: boolean
  sessionId?: string
  sourceSkill?: string
}) {
  return projectArtifact({
    sessionId: input.sessionId ?? 'session-1',
    workspaceId: 'ws-1',
    toolName: input.toolName ?? 'write',
    args: input.args ?? { path: 'C:\\work\\a.md' },
    isError: input.isError ?? false,
    ...(input.sourceSkill ? { sourceSkill: input.sourceSkill } : {}),
    createId: () => 'artifact-1',
    now: () => 1_700_000_000_000,
  })
}

describe('projectArtifact（A05）', () => {
  test('write 成功投影：name/kind/mime/path 从 args 推导，不读 details', () => {
    const artifact = project({})

    expect(artifact).toMatchObject({
      sessionId: 'session-1',
      workspaceId: 'ws-1',
      name: 'a.md',
      path: 'C:\\work\\a.md',
      kind: 'file',
      mime: 'text/markdown',
    })
  })

  test('edit 同样投影；read/delete 纯读或非产出工具不投影', () => {
    expect(project({ toolName: 'edit' })).toBeDefined()
    expect(project({ toolName: 'read' })).toBeUndefined()
    expect(project({ toolName: 'delete' })).toBeUndefined()
    expect(project({ toolName: 'bash' })).toBeUndefined()
    expect(PRODUCING_TOOLS).toEqual(new Set(['write', 'edit']))
  })

  test('失败结果不投影', () => {
    expect(project({ isError: true })).toBeUndefined()
  })

  test('图片/文档按扩展名归类', () => {
    expect(project({ args: { path: 'report.png' } })?.kind).toBe('image')
    expect(project({ args: { path: 'plan.pdf' } })?.kind).toBe('document')
    expect(project({ args: { path: 'data.ts' } })?.kind).toBe('file')
  })

  test('无路径参数不投影（file_path/filePath 也认）', () => {
    expect(project({ args: { content: 'x' } })).toBeUndefined()
    expect(project({ args: { file_path: 'C:\\x\\b.ts' } })?.name).toBe('b.ts')
    expect(project({ args: { filePath: 'C:\\x\\c.py' } })?.name).toBe('c.py')
  })

  test('sourceSkill 记录「谁产生的」', () => {
    expect(project({ sourceSkill: 'docx' })).toMatchObject({
      sourceSkill: 'docx',
    })
  })
})

describe('ArtifactRepository（A05）', () => {
  test('同路径覆盖更新，bySession 按时间返回', () => {
    const repo = new MemoryArtifactRepository()
    repo.save({
      id: 'a1', sessionId: 's1', workspaceId: 'ws1', name: 'a.md',
      path: 'C:\\a.md', kind: 'file', createdAt: 1,
    })
    repo.save({
      id: 'a2', sessionId: 's1', workspaceId: 'ws1', name: 'a.md',
      path: 'C:\\a.md', kind: 'file', mime: 'text/markdown', createdAt: 2,
    })
    repo.save({
      id: 'b1', sessionId: 's2', workspaceId: 'ws1', name: 'b.md',
      path: 'C:\\b.md', kind: 'file', createdAt: 3,
    })

    expect(repo.bySession('s1')).toHaveLength(1)
    expect(repo.bySession('s1')[0]?.id).toBe('a2')
    expect(repo.count('s1')).toBe(1)
    expect(repo.count('s2')).toBe(1)

    repo.deleteSession('s1')
    expect(repo.bySession('s1')).toHaveLength(0)
    expect(repo.bySession('s2')).toHaveLength(1)
  })
})
