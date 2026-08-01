import { useEffect, useState } from 'react'
import { Eye, ExternalLink, File, X } from 'lucide-react'
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
  { id: 'document', label: '文档' },
  { id: 'file', label: '代码' },
  { id: 'image', label: '图片' },
  { id: 'tool-output', label: '数据' },
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
  active,
  open,
  onClose,
}: {
  sessionId?: string
  /** Run 进行中标记：结束（或开始）时刷新结果列表 */
  active?: boolean
  open: boolean
  onClose(): void
}) {
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([])
  const [filter, setFilter] = useState<ArtifactFilter>('all')
  const [section, setSection] = useState<'artifacts' | 'workspace'>('artifacts')
  const [selectedId, setSelectedId] = useState<string>()
  const [runStartedAt, setRunStartedAt] = useState<number>()
  const [preview, setPreview] = useState<ArtifactPreviewResult>()

  useEffect(() => {
    setArtifacts([])
    setSelectedId(undefined)
    setPreview(undefined)
    setFilter('all')
    setSection('artifacts')
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
  const selected = artifacts.find((artifact) => artifact.id === selectedId)

  useEffect(() => {
    if (artifacts.length === 0) return
    if (!selectedId || !artifacts.some((artifact) => artifact.id === selectedId)) {
      setSelectedId(artifacts[0]!.id)
    }
  }, [artifacts, selectedId])

  if (!open) return null

  return (
    <aside
      data-testid="results-panel"
      className="flex w-[396px] shrink-0 flex-col border-l bg-background max-[1180px]:fixed max-[1180px]:bottom-0 max-[1180px]:right-0 max-[1180px]:top-9 max-[1180px]:z-40 max-[1180px]:shadow-[-20px_0_60px_rgba(0,0,0,.16)] max-[640px]:w-[92vw]"
    >
      <div className="flex h-14 shrink-0 items-center border-b px-4">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setSection('artifacts')}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${section === 'artifacts' ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
          >
            产物
          </button>
          <button
            type="button"
            onClick={() => setSection('workspace')}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${section === 'workspace' ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
          >
            工作区
          </button>
          <span className="ml-1 text-[11px] text-muted-foreground">
            {artifacts.length} 项
          </span>
        </div>
        <button
          type="button"
          aria-label="关闭结果区"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
      {section === 'artifacts' && <div className="flex gap-1.5 px-4 pb-2 pt-3">
        {FILTERS.map((option) => {
          const active = filter === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] transition-colors ${
                active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {section === 'workspace' ? (
          <div className="pt-3">
            <div className="px-1 pb-2 text-[11px] font-medium text-muted-foreground/70">
              已索引文件
            </div>
            <div className="space-y-1">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(artifact.id)
                    setSection('artifacts')
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-accent/55"
                >
                  <File size={15} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">
                    {artifact.path ?? artifact.name}
                  </span>
                </button>
              ))}
              {artifacts.length === 0 && (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                  工作区还没有已索引文件
                </p>
              )}
            </div>
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            本次会话的产出会出现在这里
          </p>
        ) : (
          <div className="space-y-5">
            {selected && preview && (
              <section data-testid="artifact-preview-card" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <header className="flex h-12 items-center gap-3 border-b px-3.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgba(82,111,159,.12)] font-mono text-[11px] font-medium text-status-info">
                    {artifactBadge(selected)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
                    {selected.path ?? selected.name}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {KIND_LABEL[selected.kind]}
                  </span>
                </header>

                <div className="min-h-[210px] p-3.5">
                  {preview.kind === 'text' ? (
                    <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-4 font-mono text-[11px] leading-[1.7] text-foreground/75">
                      {preview.text}
                    </pre>
                  ) : (
                    <div className="grid min-h-[180px] place-items-center rounded-xl bg-muted px-6 text-center text-xs text-muted-foreground">
                      {preview.kind === 'binary'
                        ? '该文件不能内联预览，请使用系统应用打开。'
                        : preview.error ?? '预览不可用'}
                    </div>
                  )}
                </div>

                <footer className="flex justify-end gap-2 border-t px-3.5 py-3">
                  <button
                    type="button"
                    data-testid="artifact-open"
                    onClick={() => {
                      if (!sessionId || !selectedId) return
                      void window.tgbuddy.artifact.open({ sessionId, artifactId: selectedId })
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-[11.5px] text-foreground/80 hover:bg-accent"
                  >
                    <ExternalLink size={13} />
                    系统打开
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-[11.5px] text-foreground/80 hover:bg-accent"
                    onClick={() => document.querySelector('[data-testid="artifact-preview-card"] pre')?.scrollTo({ top: 0 })}
                  >
                    <Eye size={13} />
                    查看
                  </button>
                </footer>
              </section>
            )}

            {groups.map((group) => (
              <div key={group.title}>
                <div className="px-1 pb-2 text-[11px] font-medium text-muted-foreground/70">
                  {group.title}
                </div>
                <div className="space-y-1">
                  {group.items.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      data-testid="result-item"
                      onClick={() => setSelectedId(artifact.id)}
                      className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11.5px] transition-colors ${
                        selectedId === artifact.id
                          ? 'bg-accent text-foreground'
                          : 'hover:bg-accent/55'
                      }`}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card font-mono text-[10px] text-status-info">
                        {artifactBadge(artifact)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-foreground">{artifact.name}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {relativeTime(artifact.createdAt)} · {KIND_LABEL[artifact.kind]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function artifactBadge(artifact: ArtifactRef): string {
  if (artifact.kind === 'image') return 'IMG'
  if (artifact.kind === 'document') return 'DOC'
  if (artifact.kind === 'tool-output') return 'OUT'
  const extension = artifact.name.split('.').at(-1)
  return extension && extension !== artifact.name
    ? extension.slice(0, 3).toUpperCase()
    : 'FILE'
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
