import type { ArtifactRef, ArtifactKind } from '../../shared/contracts/artifact.ts'

/** 产出型工具（A05 从工具 args 推导产物，不读 pi details）。 */
export const PRODUCING_TOOLS = new Set(['write', 'edit'])

/** 工具 args 里可能携带目标路径的键（与 policy 的 extractPath 同源）。 */
const PATH_KEYS = ['path', 'file_path', 'filePath'] as const

/** 常见扩展名 → MIME（结果区类型筛选用，未知回退 application/octet-stream）。 */
const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.py': 'text/x-python',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export interface ProjectArtifactInput {
  sessionId: string
  workspaceId?: string
  toolName: string
  args: Record<string, unknown>
  isError: boolean
  sourceSkill?: string
  createId(): string
  now(): number
}

/**
 * A05：成功的产出型工具从调用参数投影 Artifact。
 * - 失败 / 纯读工具 / 参数里没有路径 → 不产生；
 * - 同路径再次写入视为更新（repository 按 sessionId+path upsert）。
 */
export function projectArtifact(
  input: ProjectArtifactInput,
): ArtifactRef | undefined {
  if (input.isError) return undefined
  if (!PRODUCING_TOOLS.has(input.toolName)) return undefined
  const path = extractPath(input.args)
  if (!path) return undefined
  return {
    id: input.createId(),
    sessionId: input.sessionId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    name: basename(path),
    path,
    kind: kindOf(path),
    mime: mimeOf(path),
    ...(input.sourceSkill ? { sourceSkill: input.sourceSkill } : {}),
    createdAt: input.now(),
  }
}

function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? path
}

function kindOf(path: string): ArtifactKind {
  const mime = mimeOf(path)
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || mime.includes('word') || mime.includes('sheet') || mime.includes('presentation')) {
    return 'document'
  }
  return 'file'
}

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
