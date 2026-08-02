import type { SkillManifest, SkillSource } from './contracts/skill.ts'

export interface ParseSkillManifestContext {
  source: SkillSource
  root: string
}

export interface SkillManifestFile {
  name: string
  title: string
  description: string
  version: string
  trigger?: string
  tags?: string[]
}

/**
 * skill.json 的纯解析与校验。目录发现层把文件 JSON 喂进来，
 * 解析失败抛可诊断错误，由 catalog 逐项跳过并记录。
 */
export function parseSkillManifest(
  value: unknown,
  context: ParseSkillManifestContext,
): SkillManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`技能 manifest 不是对象：${context.root}`)
  }
  const candidate = value as Partial<SkillManifestFile>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
  const description =
    typeof candidate.description === 'string'
      ? candidate.description.trim()
      : ''
  const version =
    typeof candidate.version === 'string' ? candidate.version.trim() : ''

  if (!name) throw new Error(`技能 manifest 缺少合法 name：${context.root}`)
  if (!title) throw new Error(`技能 manifest 缺少 title：${context.root}`)
  if (!description) {
    throw new Error(`技能 manifest 缺少 description：${context.root}`)
  }
  if (!version) throw new Error(`技能 manifest 缺少 version：${context.root}`)

  const trigger =
    typeof candidate.trigger === 'string' && candidate.trigger.trim()
      ? candidate.trigger.trim()
      : undefined
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === 'string')
    : undefined

  return {
    id: `${context.source}:${name}`,
    name,
    title,
    description,
    version,
    ...(trigger ? { trigger } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    source: context.source,
    root: context.root,
    enabled: true,
  }
}

/**
 * 解析标准 SKILL.md 的 YAML frontmatter（Codex/Proma 技能格式）。
 * 目录里没有 skill.json 时由 catalog 走此路径；有 skill.json 仍以它为元数据源。
 */
export function parseSkillFrontmatter(
  content: string,
  context: ParseSkillManifestContext,
): SkillManifest {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match?.[1]) {
    throw new Error(`技能缺少 YAML frontmatter：${context.root}/SKILL.md`)
  }
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) fields[key] = value
  }
  const name = fields.name ?? ''
  const description = fields.description ?? ''
  if (!name) throw new Error(`技能 SKILL.md 缺少 name：${context.root}`)
  if (!description) {
    throw new Error(`技能 SKILL.md 缺少 description：${context.root}`)
  }
  return parseSkillManifest(
    {
      name,
      // 标准 frontmatter 没有独立 title，用 name 作为展示名
      title: name,
      description,
      version: fields.version || '1.0.0',
    },
    context,
  )
}
