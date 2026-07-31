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
