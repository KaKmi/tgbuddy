import { useEffect, useState } from 'react'
import type {
  ArtifactPreviewResult,
  ArtifactRef,
} from '../../../shared/contracts/artifact.ts'
import {
  filterArtifacts,
  groupArtifacts,
  type ArtifactFilter,
} from './results-view.ts'

const FILTERS: { id: ArtifactFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'file', label: '文件' },
  { id: 'image', label: '图片' },
  { id: 'document', label: '文档' },
  { id: 'tool-output', label: '输出' },
]

const KIND_LABEL: Record<ArtifactRef['kind'], string> = {
  file: '文件',
  image: '图片',
  document: '文档',
  'tool-output': '输出',
}

/** A06：右侧结果区。时间倒序、分「本次任务/更早」、类型筛选、选中态（A07 预览用）。 */
export function ResultsPanel({
  sessionId,
  onEditRequest,
  active,
}: {
  sessionId?: string
  onEditRequest?: (artifact: ArtifactRef) => void
  /** Run 进行中标记：结束（或开始）时刷新结果列表 */
  active?: boolean
}) {
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([])
  const [filter, setFilter] = useState<ArtifactFilter>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [runStartedAt, setRunStartedAt] = useState<number>()
  const [preview, setPreview] = useState<ArtifactPreviewResult>()

  useEffect(() => {
    setArtifacts([])
    setSelectedId(undefined)
    setPreview(undefined)
    setFilter('all')
    setRunStartedAt(undefined)
    if (!sessionId) return
    void Promise.all([
      window.tgbuddy.artifact.list(sessionId),
      window.tgbuddy.runs.list(sessionId),
    ]).then(([list, runs]) => {
      setArtifacts(list)
      const latest = runs.reduce(
        (max, run) => (run.createdAt > max ? run.createdAt : max),
        0,
      )
      setRunStartedAt(latest > 0 ? latest : undefined)
    })
  }, [sessionId, active])

  useEffect(() => {
    setPreview(undefined)
    if (!sessionId || !selectedId) return
    void window.tgbuddy.artifact
      .preview({ sessionId, artifactId: selectedId })
      .then(setPreview)
      .catch((error: unknown) => {
        setPreview({
          kind: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }, [sessionId, selectedId])

  const groups = groupArtifacts(filterArtifacts(artifacts, filter), runStartedAt)

  return (
    <aside className="hidden w-72 shrink-0 border-l bg-background lg:flex lg:flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-medium">结果</span>
        {artifacts.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {artifacts.length} 个产物
          </span>
        )}
      </div>
      <div className="flex gap-1 border-b px-3 py-2">
        {FILTERS.map((option) => {
          const active = filter === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                active ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-white/5'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            本次会话的产出会出现在这里
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.title}>
                <div className="px-1 pb-1 text-[10.5px] text-muted-foreground/70">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      data-testid="result-item"
                      onClick={() => setSelectedId(artifact.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors ${
                        selectedId === artifact.id
                          ? 'bg-accent/70 text-foreground'
                          : 'hover:bg-accent/40'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {KIND_LABEL[artifact.kind]}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/50">
                        {relativeTime(artifact.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {preview && (
        <div className="border-t bg-background px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">预览（只读）</span>
            <div className="flex gap-1.5">
              {preview.kind === 'text' && onEditRequest && (
                <button
                  type="button"
                  data-testid="artifact-edit-request"
                  onClick={() => {
                    const artifact = artifacts.find((item) => item.id === selectedId)
                    if (artifact) onEditRequest(artifact)
                  }}
                  className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#8ba7c4] hover:bg-white/10"
                >
                  让 Agent 改这份
                </button>
              )}
              <button
                type="button"
                data-testid="artifact-open"
                onClick={() => {
                  if (!sessionId || !selectedId) return
                  void window.tgbuddy.artifact.open({ sessionId, artifactId: selectedId })
                }}
                className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#8ba7c4] hover:bg-white/10"
              >
                用默认应用打开
              </button>
            </div>
          </div>
          {preview.kind === 'text' ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
              {preview.text}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {preview.kind === 'binary'
                ? '二进制文件，无法内联预览'
                : preview.error ?? '预览不可用'}
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}-${d.getDate()}`
}
