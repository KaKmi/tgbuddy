import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { SkillManifest } from '../../shared/contracts/skill.ts'
import type { SkillLoader } from '../../runtime/skills/ports/skill-loader.ts'

export interface BuildSkillToolOptions {
  /** Run 启动时冻结的启用技能摘要（正文修改只影响下一 Run 的清单） */
  skills: SkillManifest[]
  loader: SkillLoader
}

/**
 * 技能加载工具（pi adapter）。Agent 需要技能正文时按名称调用，
 * 引用资源走相对路径二次加载；内容不常驻全局 prompt。
 */
export function buildSkillTool(options: BuildSkillToolOptions): AgentTool {
  // Run 启动时冻结技能清单：正文修改/设置变更只影响下一 Run。
  const frozenSkills = [...options.skills]
  return {
    name: 'skill',
    label: '加载技能',
    description:
      '按名称加载技能正文；正文中提到的引用资源可用 resource 参数按相对路径读取。'
      + '技能名必须是可用技能列表里的名字。',
    parameters: Type.Object({
      skill: Type.String({ description: '技能名称（如 reg-check）' }),
      resource: Type.Optional(
        Type.String({ description: '技能根目录内的相对资源路径' }),
      ),
    }),
    execute: async (_id, params) => {
      const { skill, resource } = params as {
        skill: string
        resource?: string
      }
      const manifest = frozenSkills.find(
        (item) => item.name === skill || item.id === skill,
      )
      if (!manifest) {
        const available = frozenSkills.map((item) => item.name).join('、')
        throw new Error(
          `技能不存在或未启用：${skill}${available ? `。可用技能：${available}` : '（没有可用技能）'}`,
        )
      }
      if (resource) {
        const loaded = await options.loader.loadResource(manifest, resource)
        return {
          content: [{ type: 'text', text: loaded.text }],
          details: {
            skill: manifest.name,
            resource,
            tokens: loaded.tokens,
            action: 'read',
          },
        }
      }
      const loaded = await options.loader.loadBody(manifest)
      return {
        content: [{ type: 'text', text: loaded.text }],
        details: {
          skill: manifest.name,
          tokens: loaded.tokens,
          action: 'read',
        },
      }
    },
  }
}
