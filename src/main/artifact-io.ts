/**
 * A07：Artifact 只读预览与外部打开（Composition Root 注入，IPC 不碰仓库/FS）。
 *
 * 安全：路径先按工作区 mount 归一化校验，再 realpath 防 symlink 逃逸；
 * 预览只读，改动一律回对话（docs/06 决定 1）。
 */
import { realpathSync, readFileSync, statSync } from 'node:fs'
import type { ArtifactPreviewResult } from '../shared/contracts/artifact.ts'
import type {
  ArtifactRepository,
  WorkspaceCommands,
} from '../runtime/index.ts'
import { resolveArtifactInsideMount } from './artifact-path.ts'

export interface ArtifactIo {
  preview(input: { sessionId: string; artifactId: string }): Promise<ArtifactPreviewResult>
  open(
    input: { sessionId: string; artifactId: string },
  ): Promise<{ ok: boolean; error?: string }>
}

/** 文本预览上限：超过只给头部并注明，不整文件进 UI */
const PREVIEW_TEXT_LIMIT = 256 * 1024

export function createArtifactIo(options: {
  artifacts: ArtifactRepository
  workspaces: WorkspaceCommands
  openPath(path: string): Promise<string>
}): ArtifactIo {
  function resolve(artifactId: string, sessionId: string) {
    const artifact = options.artifacts
      .bySession(sessionId)
      .find((item) => item.id === artifactId)
    if (!artifact?.path || !artifact.workspaceId) {
      return { artifact, target: undefined }
    }
    const mount = options.workspaces.mountStatus(artifact.workspaceId)
    if (!mount.ok) return { artifact, target: undefined }
    const candidate = resolveArtifactInsideMount(mount.mount.path, artifact.path)
    if (!candidate) return { artifact, target: undefined }
    // 二道防线：realpath 后仍必须在 mount 内（防 symlink 指向外部）
    let canonical: string
    try {
      canonical = realpathSync(candidate)
    } catch {
      return { artifact, target: undefined }
    }
    const mountRoot = realpathSync(mount.mount.path)
    if (
      canonical.toLowerCase() !== mountRoot.toLowerCase()
      && !canonical.toLowerCase().startsWith(`${mountRoot.toLowerCase()}\\`)
    ) {
      return { artifact, target: undefined }
    }
    return { artifact, target: canonical }
  }

  return {
    async preview({ sessionId, artifactId }) {
      const { target } = resolve(artifactId, sessionId)
      if (!target) return { kind: 'error', error: '产物不可用（缺失或路径越界）' }
      try {
        const stat = statSync(target)
        if (!stat.isFile()) return { kind: 'error', error: '产物不是普通文件' }
        const bytes = readFileSync(target)
        // 二进制启发：含 NUL 字节按二进制处理（图片等走外部打开）
        if (bytes.includes(0)) return { kind: 'binary' }
        const text = new TextDecoder().decode(bytes)
        return {
          kind: 'text',
          text:
            text.length > PREVIEW_TEXT_LIMIT
              ? `${text.slice(0, PREVIEW_TEXT_LIMIT)}\n\n（预览截断，完整内容用「打开」查看）`
              : text,
        }
      } catch (error) {
        return {
          kind: 'error',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async open({ sessionId, artifactId }) {
      const { target } = resolve(artifactId, sessionId)
      if (!target) return { ok: false, error: '产物不可用（缺失或路径越界）' }
      try {
        const error = await options.openPath(target)
        return error ? { ok: false, error } : { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
