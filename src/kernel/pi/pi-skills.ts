/**
 * Skill 与 pi 原生能力的对齐适配（docs/02-功能范围 2.1 要求复用 pi 的
 * `formatSkillsForSystemPrompt` / `formatSkillInvocation`）。
 *
 * 发现/分组/开关仍是应用层扩展；「system prompt 技能摘要」和
 * 「显式调用正文块」的格式交给 pi 生成，保证模型判断逻辑与 pi 一致。
 */

import {
  formatSkillInvocation as piFormatSkillInvocation,
  formatSkillsForSystemPrompt as piFormatSkillsForSystemPrompt,
  type Skill,
} from '@earendil-works/pi-agent-core'
import { join } from 'node:path'
import type { SkillManifest } from '../../shared/contracts/skill.ts'

/**
 * 把应用 SkillManifest 映射成 pi 的 Skill。
 * system prompt 只需要 name/description/location，content 留空；
 * 显式调用时由 loader 读正文后填充。
 */
export function toPiSkill(manifest: SkillManifest): Skill {
  return {
    name: manifest.name,
    description: manifest.description,
    content: '',
    filePath: join(manifest.root, 'SKILL.md'),
  }
}

/** system prompt 技能摘要块：pi 的 `<available_skills>` 格式（name/description/location）。 */
export function formatSkillsSystemPrompt(skills: SkillManifest[]): string {
  return piFormatSkillsForSystemPrompt(skills.map(toPiSkill))
}

/** 显式技能调用块：把加载到的正文按 pi 的 `<skill name location>` 格式注入模型。 */
export function formatSkillInvocationBlock(
  manifest: SkillManifest,
  content: string,
  additionalInstructions?: string,
): string {
  return piFormatSkillInvocation(
    {
      name: manifest.name,
      description: manifest.description,
      content,
      filePath: join(manifest.root, 'SKILL.md'),
    },
    additionalInstructions,
  )
}
