import type { ArtifactId, AgentRunId, SessionId, WorkspaceId } from './ids.ts'
import type { BlobRef } from './blob.ts'

export type ArtifactKind = 'file' | 'image' | 'document' | 'tool-output'

/**
 * 产物引用（A05）。
 *
 * - 工作区文件产物：path 指向工作区文件，文件原地不动，索引存 SQLite；
 * - 非工作区产物（超长工具输出等）：blob 指向 BlobStore；
 * - producerRunId 在 D01 lineage 落地后精确填充，A05 阶段可省略；
 * - sourceSkill 记录「谁产生的」（docs/06 决定 1），D04 折叠组展示用。
 */
export interface ArtifactRef {
  id: ArtifactId
  workspaceId?: WorkspaceId
  sessionId: SessionId
  producerRunId?: AgentRunId
  kind: ArtifactKind
  name: string
  path?: string
  blob?: BlobRef
  size?: number
  mime?: string
  /** A05：来源技能名（docs/06 决定 1 的「谁产生的」） */
  sourceSkill?: string
  createdAt: number
}

/** A07：只读预览结果（文本/二进制/缺失/错误）。 */
export interface ArtifactPreviewResult {
  kind: 'text' | 'binary' | 'missing' | 'error'
  text?: string
  error?: string
}
