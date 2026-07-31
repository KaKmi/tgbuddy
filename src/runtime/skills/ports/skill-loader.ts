import type { SkillManifest } from '../../../shared/contracts/skill.ts'

export interface LoadedSkillContent {
  text: string
  /** 估算 token 数，供能力快照与上下文用量记账 */
  tokens: number
}

/**
 * 技能正文按需加载端口。技能内容不常驻全局 prompt：
 * Agent 调用 skill 工具时才读取，且只能读技能根目录内资源。
 */
export interface SkillLoader {
  loadBody(manifest: SkillManifest): Promise<LoadedSkillContent>
  loadResource(
    manifest: SkillManifest,
    relativePath: string,
  ): Promise<LoadedSkillContent>
}
