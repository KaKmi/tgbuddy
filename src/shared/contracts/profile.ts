/**
 * Profile —— 命名的模型配置预设（对应原型「专家」概念）：
 * 渠道 + 模型 + 可选系统提示词。会话选中 Profile 后，
 * 下一 Run 使用该配置的不可变快照。
 */
export interface Profile {
  id: string
  name: string
  channelId: string
  modelId: string
  systemPrompt?: string
  /** undefined = 自动使用全部已启用技能；数组（含空数组）= 显式 allowlist。 */
  skillIds?: string[]
  createdAt: number
  updatedAt: number
}

/** 保存 Profile 的输入：新 Profile 可不带 id/时间戳（由 Runtime 生成）。 */
export type ProfileSaveInput = Omit<
  Profile,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: string }
