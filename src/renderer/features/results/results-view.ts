import type { ArtifactKind, ArtifactRef } from '../../../shared/contracts/artifact.ts'

export type ArtifactFilter = 'all' | ArtifactKind

export interface ResultsGroup {
  title: string
  items: ArtifactRef[]
}

/** A06：结果按时间倒序；latestRunStartedAt 之前归「更早」，之后归「本次任务」。 */
export function groupArtifacts(
  artifacts: ArtifactRef[],
  latestRunStartedAt?: number,
): ResultsGroup[] {
  const sorted = [...artifacts].sort((a, b) => b.createdAt - a.createdAt)
  if (latestRunStartedAt === undefined) {
    return sorted.length > 0 ? [{ title: '本次任务', items: sorted }] : []
  }
  return [
    {
      title: '本次任务',
      items: sorted.filter((item) => item.createdAt >= latestRunStartedAt),
    },
    {
      title: '更早',
      items: sorted.filter((item) => item.createdAt < latestRunStartedAt),
    },
  ].filter((group) => group.items.length > 0)
}

/** A06：按类型筛选（全部 / 文件 / 图片 / 文档 / 工具输出）。 */
export function filterArtifacts(
  artifacts: ArtifactRef[],
  filter: ArtifactFilter,
): ArtifactRef[] {
  return filter === 'all' ? artifacts : artifacts.filter((item) => item.kind === filter)
}
