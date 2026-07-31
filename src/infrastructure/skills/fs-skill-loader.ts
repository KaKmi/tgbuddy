import {
  existsSync,
  readFileSync,
} from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type { SkillManifest } from '../../shared/contracts/skill.ts'
import type {
  LoadedSkillContent,
  SkillLoader,
} from '../../runtime/skills/ports/skill-loader.ts'

const BODY_FILE = 'SKILL.md'

/**
 * 基于文件系统的技能正文加载器。读取必须经过安全边界：
 * 正文只读 `<root>/SKILL.md`，资源只允许 root 内的相对路径，
 * `..`、绝对路径一律拒绝。
 */
export class FsSkillLoader implements SkillLoader {
  async loadBody(manifest: SkillManifest): Promise<LoadedSkillContent> {
    const bodyPath = join(manifest.root, BODY_FILE)
    if (!existsSync(bodyPath)) {
      throw new Error(`技能缺少正文文件：${manifest.id}（${BODY_FILE}）`)
    }
    const text = readFileSync(bodyPath, 'utf8')
    return { text, tokens: estimateTokens(text) }
  }

  async loadResource(
    manifest: SkillManifest,
    relativePath: string,
  ): Promise<LoadedSkillContent> {
    if (isAbsolute(relativePath)) {
      throw new Error(`技能资源不允许使用绝对路径：${relativePath}`)
    }
    const root = resolve(manifest.root)
    const target = resolve(root, relativePath)
    if (!isPathInside(root, target)) {
      throw new Error(`技能资源越界引用被拒绝：${relativePath}`)
    }
    if (!existsSync(target)) {
      throw new Error(`技能资源不存在：${manifest.id}/${relativePath}`)
    }
    const text = readFileSync(target, 'utf8')
    return { text, tokens: estimateTokens(text) }
  }
}

export function createFsSkillLoader(): SkillLoader {
  return new FsSkillLoader()
}

function isPathInside(root: string, target: string): boolean {
  // Windows 路径大小写不敏感：统一小写比较，避免误拒合法子路径。
  const normalizedRoot = normalize(root).replace(/[\\/]+$/, '').toLowerCase()
  const normalizedTarget = normalize(target).toLowerCase()
  return (
    normalizedTarget === normalizedRoot
    || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  )
}

/** 粗略估算：约 4 字符/token，只用于记账与用量提示。 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}
