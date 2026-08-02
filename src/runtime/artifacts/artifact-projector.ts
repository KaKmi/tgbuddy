import type { ArtifactRef, ArtifactKind } from '../../shared/contracts/artifact.ts'

/**
 * 产出型工具（A05 从工具 args 推导产物，不读 pi details）。
 * bash 是文档/表格技能的产出通道（pandoc/soffice/docx-js 等），
 * 输出路径从命令参数提取（重定向 / -o / --output / --convert-to）。
 */
export const PRODUCING_TOOLS = new Set(['write', 'edit', 'bash'])

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
  const path =
    input.toolName === 'bash'
      ? extractBashOutputPath(commandOf(input.args))
      : extractPath(input.args)
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

/**
 * 从 bash 命令推导产出文件路径（保守规则，只认显式输出目标）：
 * - `> out.docx` / `1> out.docx`（排除 `2>` 错误重定向）；
 * - `-o out.pdf` / `--output out.pdf` / `--output=out.pdf`；
 * - `--outdir out/` 目录 + 已知扩展名的输入文件；
 * - `--convert-to docx input.md` → 输出为输入换扩展名。
 */
export function extractBashOutputPath(command: string | undefined): string | undefined {
  if (!command) return undefined

  // 重定向后可跟空格（`> report.docx`），路径类排除 > 避免 `>>` 二次误配
  const redirect = command.match(/(?:^|[\s;|&])([12]?)>>?\s*([^\s|&;"'>]+)/)
  if (redirect) {
    // `2>` 是 stderr 重定向，不是产物
    if (redirect[1] !== '2') {
      return redirect[2]
    }
  }

  const flag = command.match(/(?:^|[\s;|&])(?:-o|--output)[=\s]+([^\s|&;"']+)/)
  if (flag?.[1]) return flag[1]

  const convert = command.match(/(?:^|[\s;|&])--convert-to[^\S\r\n]+([\w.]+)[^\S\r\n]+([^\s|&;"']+)/)
  if (convert?.[1] && convert[2]) {
    const input = convert[2].replace(/["']/g, '')
    const dot = input.lastIndexOf('.')
    const base = dot === -1 ? input : input.slice(0, dot)
    return `${base}.${convert[1]}`
  }

  const outdir = command.match(/(?:^|[\s;|&])--outdir[=\s]+([^\s|&;"']+)/)
  if (outdir?.[1]) {
    const input = command.match(/(?:^|[\s;|&])([^\s|&;"']+\.(?:docx|pdf|xlsx|pptx|md|txt|html))/)
    if (input?.[1]) {
      const base = input[1].split(/[\\/]/).at(-1) ?? input[1]
      return `${outdir[1].replace(/\/$/, '')}\\${base}`
    }
  }

  return undefined
}

function commandOf(args: Record<string, unknown>): string | undefined {
  return typeof args.command === 'string' ? args.command : undefined
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
