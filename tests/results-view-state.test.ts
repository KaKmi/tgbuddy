import { describe, expect, test } from 'bun:test'
import {
  filterArtifacts,
  groupArtifacts,
  type ArtifactFilter,
} from '../src/renderer/features/results/results-view.ts'
import type { ArtifactRef } from '../src/shared/contracts/artifact.ts'

function artifact(
  id: string,
  createdAt: number,
  kind: ArtifactRef['kind'] = 'file',
): ArtifactRef {
  return {
    id,
    sessionId: 's1',
    name: `${id}.md`,
    path: `C:\\${id}.md`,
    kind,
    createdAt,
  }
}

describe('结果视图状态（A06）', () => {
  test('时间倒序；latestRunStartedAt 之后归本次任务、之前归更早', () => {
    const groups = groupArtifacts(
      [artifact('a', 100), artifact('b', 300), artifact('c', 200)],
      250,
    )

    expect(groups).toEqual([
      { title: '本次任务', items: [artifact('b', 300)] },
      { title: '更早', items: [artifact('c', 200), artifact('a', 100)] },
    ])
  })

  test('无 run 边界时全部归本次任务（时间倒序）', () => {
    const groups = groupArtifacts([artifact('a', 100), artifact('b', 300)])
    expect(groups).toEqual([{ title: '本次任务', items: [artifact('b', 300), artifact('a', 100)] }])
  })

  test('空列表不产生分组', () => {
    expect(groupArtifacts([])).toEqual([])
  })

  test('按类型筛选：all 全量，其它只留匹配 kind', () => {
    const list = [
      artifact('f1', 1, 'file'),
      artifact('i1', 2, 'image'),
      artifact('d1', 3, 'document'),
    ]
    const filter: ArtifactFilter = 'image'
    expect(filterArtifacts(list, 'all')).toHaveLength(3)
    expect(filterArtifacts(list, filter).map((item) => item.id)).toEqual(['i1'])
  })
})
