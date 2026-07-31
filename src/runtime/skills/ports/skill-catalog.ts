import type {
  SkillGroupView,
  SkillManifest,
} from '../../../shared/contracts/skill.ts'

/**
 * 技能目录端口。Runtime 只依赖该端口；发现/解析由 infrastructure
 * filesystem adapter 提供，列表阶段不加载正文。
 */
export interface SkillCatalog {
  /** 按来源分组列出技能；workspaceId 切换即刷新工作区来源 */
  groups(workspaceId?: string): SkillGroupView[]
  /** 全部技能（不分来源），供快照与正文加载使用 */
  list(workspaceId?: string): SkillManifest[]
  setEnabled(skillId: string, enabled: boolean): void
}
