import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type {
  SkillGroupView,
  SkillManifest,
  SkillSource,
} from '../../shared/contracts/skill.ts'
import {
  parseSkillFrontmatter,
  parseSkillManifest,
} from '../../shared/skill-manifest-parser.ts'
import type { SkillCatalog } from '../../runtime/skills/ports/skill-catalog.ts'

export interface CreateFsSkillCatalogOptions {
  /** 用户级全局技能根（含 seed 进来的内置预装，靠 source.json 区分） */
  userRoots: string[]
  /** 工作区根目录随 workspaceId 解析，切换工作区即刷新 */
  workspaceRoots(workspaceId: string): string[]
}

const MANIFEST_FILE = 'skill.json'
const SOURCE_FILE = 'source.json'

/** 复制内置技能时永远跳过的目录（防 .git/依赖目录爆炸）。 */
const SEED_BLOCKLIST = new Set(['.git', '.DS_Store', 'node_modules', 'dist'])

export interface SeedBuiltinSkillsResult {
  seeded: string[]
  skipped: string[]
}

/**
 * 把安装包内置技能 seed 到用户级全局目录（`~/.tgbuddy/skills/`）。
 *
 * - 幂等：目标已存在时跳过，绝不覆盖用户对技能的修改；
 * - 每个 seed 进来的技能目录写 `source.json { source: "builtin" }`，
 *   设置页据此归入「内置技能」分组，与用户自装技能区分。
 */
export function seedBuiltinSkills(options: {
  sourceRoots: string[]
  targetRoot: string
}): SeedBuiltinSkillsResult {
  const result: SeedBuiltinSkillsResult = { seeded: [], skipped: [] }
  for (const sourceRoot of options.sourceRoots) {
    if (!existsSync(sourceRoot)) continue
    let entries: string[]
    try {
      entries = readdirSync(sourceRoot)
    } catch (error) {
      console.error(`[skills] 内置技能源读取失败，跳过：${sourceRoot}`, error)
      continue
    }
    for (const entry of entries) {
      const source = join(sourceRoot, entry)
      let isDirectory = false
      try {
        isDirectory = statSync(source).isDirectory()
      } catch {
        continue
      }
      if (!isDirectory || SEED_BLOCKLIST.has(entry)) continue
      const target = join(options.targetRoot, entry)
      if (existsSync(target)) {
        // 用户可能已经改过同名技能：只补缺失，不覆盖。
        result.skipped.push(entry)
        continue
      }
      try {
        cpSync(source, target, {
          recursive: true,
          filter: (src) => !SEED_BLOCKLIST.has(join(src).split(/[\\/]/).at(-1) ?? ''),
        })
        writeFileSync(
          join(target, SOURCE_FILE),
          JSON.stringify({ source: 'builtin', seededAt: new Date().toISOString() }, null, 2),
          'utf8',
        )
        result.seeded.push(entry)
      } catch (error) {
        console.error(`[skills] 内置技能 seed 失败，跳过：${entry}`, error)
      }
    }
  }
  return result
}

/**
 * 基于文件系统的技能目录：扫描各来源根目录下的 skill.json，
 * 解析失败跳过并记录诊断；同一来源重复名只保留第一个。
 * 本阶段只读元数据，不加载正文（C08）。
 */
export class FsSkillCatalog implements SkillCatalog {
  readonly #userRoots: string[]
  readonly #workspaceRoots: (workspaceId: string) => string[]
  readonly #disabled = new Set<string>()

  constructor(options: CreateFsSkillCatalogOptions) {
    this.#userRoots = options.userRoots
    this.#workspaceRoots = options.workspaceRoots
  }

  groups(workspaceId?: string): SkillGroupView[] {
    const bySource = collectFromUserRoots(this.#userRoots)
    return [
      {
        source: 'builtin' as const,
        title: '内置技能',
        items: bySource.builtin,
      },
      {
        source: 'user' as const,
        title: '用户级技能',
        items: bySource.user,
      },
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

/** 用户级根目录扫描：带 `source: builtin` 标记的归内置（预装），其余归用户级。 */
function collectFromUserRoots(roots: string[]): {
  builtin: SkillManifest[]
  user: SkillManifest[]
} {
  const builtin: SkillManifest[] = []
  const user: SkillManifest[] = []
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
      const isBuiltin = readSkillSource(dir) === 'builtin'
      // 先判定来源再解析，保证 id（`<source>:<name>`）与分组一致。
      const skill = readSkillManifest(dir, isBuiltin ? 'builtin' : 'user')
      if (!skill) continue
      const bucket = isBuiltin ? builtin : user
      if (bucket.some((item) => item.name === skill.name)) {
        console.warn(`[skills] 跳过重复技能名 ${skill.name}（${dir}）`)
        continue
      }
      bucket.push(skill)
    }
  }
  return { builtin, user }
}

function readSkillSource(dir: string): string | undefined {
  const sourcePath = join(dir, SOURCE_FILE)
  if (!existsSync(sourcePath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as { source?: unknown }
    return typeof parsed.source === 'string' ? parsed.source : undefined
  } catch {
    return undefined
  }
}

function readSkillManifest(
  dir: string,
  source: SkillSource,
): SkillManifest | undefined {
  const manifestPath = join(dir, MANIFEST_FILE)
  try {
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
      return parseSkillManifest(parsed, { source, root: dir })
    }
    const skillMdPath = join(dir, 'SKILL.md')
    if (!existsSync(skillMdPath)) return undefined
    return parseSkillFrontmatter(readFileSync(skillMdPath, 'utf8'), {
      source,
      root: dir,
    })
  } catch (error) {
    console.error(`[skills] 技能 manifest 解析失败，跳过：${manifestPath}`, error)
    return undefined
  }
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
      const skill = readSkillManifest(dir, source)
      if (!skill) continue
      if (seen.has(skill.name)) {
        console.warn(`[skills] 跳过重复技能名 ${skill.name}（${dir}）`)
        continue
      }
      seen.add(skill.name)
      items.push(skill)
    }
  }
  return { source, title, items }
}
