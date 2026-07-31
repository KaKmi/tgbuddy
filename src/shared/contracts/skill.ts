export type SkillSource = 'builtin' | 'user' | 'workspace'

/**
 * Skill manifest —— 技能是说明书 + 可选脚本（原型 settings/skills）。
 * 列表阶段只读元数据；正文与引用资源按需加载（C08）。
 */
export interface SkillManifest {
  /** 稳定 id：`<source>:<name>` */
  id: string
  name: string
  title: string
  description: string
  version: string
  trigger?: string
  tags?: string[]
  source: SkillSource
  /** manifest 所在目录，正文加载的安全根 */
  root: string
  enabled: boolean
}

/** 设置页技能分组：内置 / 用户级 / 工作区。 */
export interface SkillGroupView {
  source: SkillSource
  title: string
  items: SkillManifest[]
}
