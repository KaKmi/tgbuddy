import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import type {
  SkillGroupView,
  SkillManifest,
  SkillSource,
} from '../../shared/contracts/skill.ts'
import { parseSkillManifest } from '../../shared/skill-manifest-parser.ts'
import type { SkillCatalog } from '../../runtime/skills/ports/skill-catalog.ts'

export interface CreateFsSkillCatalogOptions {
  builtinRoots: string[]
  userRoots: string[]
  /** 工作区根目录随 workspaceId 解析，切换工作区即刷新 */
  workspaceRoots(workspaceId: string): string[]
}

const MANIFEST_FILE = 'skill.json'

/**
 * 基于文件系统的技能目录：扫描各来源根目录下的 skill.json，
 * 解析失败跳过并记录诊断；同一来源重复名只保留第一个。
 * 本阶段只读元数据，不加载正文（C08）。
 */
export class FsSkillCatalog implements SkillCatalog {
  readonly #builtinRoots: string[]
  readonly #userRoots: string[]
  readonly #workspaceRoots: (workspaceId: string) => string[]
  readonly #disabled = new Set<string>()

  constructor(options: CreateFsSkillCatalogOptions) {
    this.#builtinRoots = options.builtinRoots
    this.#userRoots = options.userRoots
    this.#workspaceRoots = options.workspaceRoots
  }

  groups(workspaceId?: string): SkillGroupView[] {
    return [
      collectGroup('builtin', '内置技能', this.#builtinRoots),
      collectGroup('user', '用户级技能', this.#userRoots),
      ...(workspaceId
        ? [collectGroup('workspace', '工作区技能', this.#workspaceRoots(workspaceId))]
        : []),
    ].map((group) => ({
      ...group,
      items: group.items.map((skill) => ({
        ...skill,
        enabled: !this.#disabled.has(skill.id),
      })),
    }))
  }

  list(workspaceId?: string): SkillManifest[] {
    return this.groups(workspaceId).flatMap((group) => group.items)
  }

  setEnabled(skillId: string, enabled: boolean): void {
    if (enabled) this.#disabled.delete(skillId)
    else this.#disabled.add(skillId)
  }
}

export function createFsSkillCatalog(
  options: CreateFsSkillCatalogOptions,
): SkillCatalog {
  return new FsSkillCatalog(options)
}

function collectGroup(
  source: SkillSource,
  title: string,
  roots: string[],
): SkillGroupView {
  const items: SkillManifest[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch (error) {
      console.error(`[skills] 技能目录读取失败，跳过：${root}`, error)
      continue
    }
    for (const entry of entries) {
      const dir = join(root, entry)
      let isDirectory = false
      try {
        isDirectory = statSync(dir).isDirectory()
      } catch {
        continue
      }
      if (!isDirectory) continue
      const manifestPath = join(dir, MANIFEST_FILE)
      if (!existsSync(manifestPath)) continue
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
        const skill = parseSkillManifest(parsed, { source, root: dir })
        if (seen.has(skill.name)) {
          console.warn(`[skills] 跳过重复技能名 ${skill.name}（${dir}）`)
          continue
        }
        seen.add(skill.name)
        items.push(skill)
      } catch (error) {
        console.error(
          `[skills] 技能 manifest 解析失败，跳过：${manifestPath}`,
          error,
        )
      }
    }
  }
  return { source, title, items }
}
