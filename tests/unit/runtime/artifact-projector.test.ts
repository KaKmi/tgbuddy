import { describe, expect, test } from 'bun:test'
import {
  extractBashOutputPath,
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
    expect(PRODUCING_TOOLS).toEqual(new Set(['write', 'edit', 'bash']))
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

describe('extractBashOutputPath（A05 导出类工具）', () => {
  test('重定向 `>` 提取输出路径，`2>` 排除', () => {
    expect(extractBashOutputPath('node gen.js > report.docx')).toBe('report.docx')
    expect(extractBashOutputPath('pandoc a.md -o out.pdf 2> err.log')).toBe('out.pdf')
    expect(extractBashOutputPath('node gen.js > out.txt 2>&1')).toBe('out.txt')
  })

  test('`-o` / `--output` / `--output=` 提取', () => {
    expect(extractBashOutputPath('pandoc a.md -o out.pdf')).toBe('out.pdf')
    expect(extractBashOutputPath('soffice --convert-to docx a.md')).toBe('a.docx')
    expect(extractBashOutputPath('tool --output=result.json')).toBe('result.json')
  })

  test('纯读命令 / stderr 重定向不产出', () => {
    expect(extractBashOutputPath('git status')).toBeUndefined()
    expect(extractBashOutputPath('node gen.js 2> err.log')).toBeUndefined()
    expect(extractBashOutputPath('ls -la')).toBeUndefined()
  })

  test('bash 命令含输出路径时投影为 document 产物', () => {
    const artifact = project({
      toolName: 'bash',
      args: { command: 'pandoc report.md -o report.pdf' },
    })
    expect(artifact).toMatchObject({
      name: 'report.pdf',
      kind: 'document',
      mime: 'application/pdf',
    })
  })
})
