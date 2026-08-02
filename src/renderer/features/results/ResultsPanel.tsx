import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Code2,
  Eye,
  ExternalLink,
  File,
  FileImage,
  FileText,
  Folder,
  RefreshCw,
  Search,
  Table2,
  X,
} from 'lucide-react'
import type {
  ArtifactPreviewResult,
  ArtifactRef,
} from '../../../shared/contracts/artifact.ts'
import type { DelegationTask } from '../../../shared/contracts/delegation.ts'
import {
  filterArtifacts,
  groupArtifacts,
  type ArtifactFilter,
} from './results-view.ts'
import { TaskWorkbench } from '../delegation/TaskWorkbench.tsx'

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
  const [section, setSection] = useState<'artifacts' | 'workspace' | 'tasks'>('artifacts')
  const [selectedId, setSelectedId] = useState<string>()
  const [runStartedAt, setRunStartedAt] = useState<number>()
  const [taskProjection, setTaskProjection] = useState<{
    sessionId: string
    tasks: DelegationTask[]
  }>()
  const [preview, setPreview] = useState<ArtifactPreviewResult>()
  const [viewerOpen, setViewerOpen] = useState(false)
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const currentTaskSessionRef = useRef(sessionId)
  const latestTaskRequestRef = useRef(0)
  currentTaskSessionRef.current = sessionId

  async function refreshArtifacts(): Promise<void> {
    if (!sessionId) return
    const [list, runs] = await Promise.all([
      window.tgbuddy.artifact.list(sessionId),
      window.tgbuddy.runs.list(sessionId),
    ])
    setArtifacts(list)
    const latest = runs.reduce(
      (current, run) => (!current || run.createdAt > current.createdAt ? run : current),
      undefined as (typeof runs)[number] | undefined,
    )
    setRunStartedAt(latest?.createdAt)
  }

  async function refreshTasks(targetSessionId = sessionId): Promise<void> {
    if (!targetSessionId) return
    const requestId = ++latestTaskRequestRef.current
    const nextTasks = await window.tgbuddy.delegation.list(targetSessionId)
    if (
      currentTaskSessionRef.current !== targetSessionId
      || latestTaskRequestRef.current !== requestId
    ) return
    setTaskProjection({ sessionId: targetSessionId, tasks: nextTasks })
  }

  useEffect(() => {
    setArtifacts([])
    setSelectedId(undefined)
    setPreview(undefined)
    setFilter('all')
    setSection('artifacts')
    setRunStartedAt(undefined)
    setTaskProjection(undefined)
    if (!sessionId) return
    void Promise.all([refreshArtifacts(), refreshTasks()])
  }, [sessionId])

  useEffect(() => {
    latestTaskRequestRef.current += 1
    if (!sessionId) return
    void Promise.all([refreshArtifacts(), refreshTasks(sessionId)])
    return () => {
      latestTaskRequestRef.current += 1
    }
  }, [active])

  useEffect(() => {
    if (!open || !sessionId) return
    const timer = window.setInterval(() => void refreshTasks(), 800)
    return () => window.clearInterval(timer)
  }, [open, sessionId])

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
  const tasks = taskProjection && taskProjection.sessionId === sessionId
    ? taskProjection.tasks
    : []

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
      className="flex w-[356px] shrink-0 flex-col border-l bg-background max-[1180px]:fixed max-[1180px]:bottom-0 max-[1180px]:right-0 max-[1180px]:top-9 max-[1180px]:z-40 max-[1180px]:shadow-[-18px_0_50px_rgba(30,28,24,.13)] max-[640px]:w-[92vw]"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3.5">
        <div className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setSection('artifacts')}
            className={`rounded-[7px] px-2 py-1.5 text-[11.5px] font-semibold ${section === 'artifacts' ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
          >
            产物
          </button>
          <button
            type="button"
            onClick={() => setSection('workspace')}
            className={`rounded-[7px] px-2 py-1.5 text-[11.5px] font-semibold ${section === 'workspace' ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
          >
            工作区
          </button>
          <button
            type="button"
            onClick={() => setSection('tasks')}
            className={`rounded-[7px] px-2 py-1.5 text-[11.5px] font-semibold ${section === 'tasks' ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}
          >
            子智能体
            <span data-testid="results-section-count" className="ml-1 text-[10.5px] font-normal text-muted-foreground/70">
              {tasks.length} 项
            </span>
          </button>
        </div>
        <button
          type="button"
          aria-label="关闭结果区"
          onClick={onClose}
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
      {section === 'artifacts' && artifacts.length > 0 && <div className="flex gap-[5px] overflow-x-auto px-[13px] py-2.5">
        {FILTERS.map((option) => {
          const active = filter === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-full px-[9px] py-[5px] text-[10.8px] transition-colors ${
                active ? 'bg-primary text-primary-foreground' : 'bg-card/60 text-muted-foreground hover:bg-accent'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === 'tasks' ? (
          <TaskWorkbench
            key={sessionId ?? 'no-session'}
            sessionId={sessionId}
            tasks={tasks}
            onRefreshTasks={refreshTasks}
          />
        ) : section === 'workspace' ? (
          <WorkspaceFiles
            artifacts={artifacts}
            selectedId={selectedId}
            query={workspaceQuery}
            onQueryChange={setWorkspaceQuery}
            onRefresh={() => void refreshArtifacts()}
            onSelect={(artifact) => {
              setSelectedId(artifact.id)
              setViewerOpen(true)
            }}
            onOpen={(artifact) => {
              if (!sessionId) return
              void window.tgbuddy.artifact.open({ sessionId, artifactId: artifact.id })
            }}
          />
        ) : artifacts.length === 0 ? (
          <ResultsEmptyState />
        ) : groups.length === 0 ? (
          <p className="px-4 py-10 text-center text-[11.5px] text-muted-foreground">
            没有符合当前筛选条件的产物
          </p>
        ) : (
          <div>
            {selected && preview && (
              <section data-testid="artifact-preview-card" className="mx-3 mb-2.5 overflow-hidden rounded-[13px] border bg-card shadow-[0_1px_3px_rgba(30,28,24,.05)]">
                <header className="flex h-10 items-center gap-[7px] border-b px-[11px]">
                  <span className="shrink-0 rounded-[5px] bg-status-running/10 px-[7px] py-[3px] font-mono text-[10px] font-medium text-status-running">
                    {artifactBadge(selected)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground">
                    {selected.path ?? selected.name}
                  </span>
                  <span className="text-[9.8px] text-muted-foreground/70">
                    {KIND_LABEL[selected.kind]}
                  </span>
                </header>

                <div className="h-[218px] overflow-auto p-[15px]">
                  {preview.kind === 'text' ? (
                    <pre className="min-h-full overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-[10.8px] leading-[1.7] text-foreground/75">
                      {preview.text}
                    </pre>
                  ) : (
                    <div className="grid min-h-full place-items-center rounded-lg bg-muted px-6 text-center text-[11.5px] text-muted-foreground">
                      {preview.kind === 'binary'
                        ? '该文件不能内联预览，请使用系统应用打开。'
                        : preview.error ?? '预览不可用'}
                    </div>
                  )}
                </div>

                <footer className="flex justify-end gap-1.5 border-t px-2.5 py-[9px]">
                  <button
                    type="button"
                    data-testid="artifact-open"
                    onClick={() => {
                      if (!sessionId || !selectedId) return
                      void window.tgbuddy.artifact.open({ sessionId, artifactId: selectedId })
                    }}
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border bg-card px-[11px] text-[11.5px] text-foreground/80 hover:bg-accent"
                  >
                    <ExternalLink size={13} />
                    系统打开
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border bg-card px-[11px] text-[11.5px] text-foreground/80 hover:bg-accent"
                    onClick={() => setViewerOpen(true)}
                  >
                    <Eye size={13} />
                    查看
                  </button>
                </footer>
              </section>
            )}

            <div className="min-h-0 px-2.5 pb-3">
            {groups.map((group) => (
              <div key={group.title} className="mt-[9px] flex flex-col gap-0.5">
                <div className="px-[5px] py-[5px] text-[10px] font-semibold tracking-[.07em] text-muted-foreground/70">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      data-testid="result-item"
                      onClick={() => setSelectedId(artifact.id)}
                      className={`flex w-full items-center gap-[9px] rounded-[10px] p-2 text-left transition-colors ${
                        selectedId === artifact.id
                          ? 'bg-accent text-foreground'
                          : 'hover:bg-accent/55'
                      }`}
                    >
                      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-card font-mono text-[9px] text-status-running">
                        {artifactBadge(artifact)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[10.8px] text-foreground">{artifact.name}</span>
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
          </div>
        )}
      </div>
      {viewerOpen && selected && (
        <FileViewer
          artifact={selected}
          preview={preview}
          onClose={() => setViewerOpen(false)}
          onOpen={() => {
            if (!sessionId) return
            void window.tgbuddy.artifact.open({ sessionId, artifactId: selected.id })
          }}
        />
      )}
    </aside>
  )
}

function WorkspaceFiles({
  artifacts,
  selectedId,
  query,
  onQueryChange,
  onRefresh,
  onSelect,
  onOpen,
}: {
  artifacts: ArtifactRef[]
  selectedId?: string
  query: string
  onQueryChange(value: string): void
  onRefresh(): void
  onSelect(artifact: ArtifactRef): void
  onOpen(artifact: ArtifactRef): void
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = artifacts.filter((artifact) =>
    (artifact.path ?? artifact.name).toLocaleLowerCase().includes(normalizedQuery),
  )
  const groups = groupWorkspaceFiles(visible)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-[5px] border-b px-2.5 py-[9px]">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] bg-muted px-2 py-1.5 text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="筛选工作区文件"
            className="min-w-0 flex-1 bg-transparent text-[10.5px] text-foreground outline-none placeholder:text-muted-foreground/65"
          />
        </label>
        <button
          type="button"
          aria-label="刷新工作区文件"
          onClick={onRefresh}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-[9px]">
        <div className="flex items-center gap-2 rounded-[8px] px-2 py-[7px] text-foreground/85">
          <Folder className="h-3.5 w-3.5 text-status-running" strokeWidth={1.7} />
          <strong className="min-w-0 flex-1 truncate text-[11.5px] font-medium">当前工作区</strong>
          <small className="text-[9.5px] text-muted-foreground/70">自动刷新</small>
        </div>

        {groups.map((group) => (
          <section key={group.directory}>
            {group.directory && (
              <div className="flex items-center gap-1.5 rounded-[7px] px-2 py-1.5 text-[10.8px] text-muted-foreground">
                <ChevronDown className="h-3 w-3" strokeWidth={1.7} />
                <Folder className="h-3.5 w-3.5" strokeWidth={1.7} />
                <span className="truncate">{group.directory}</span>
              </div>
            )}
            {group.items.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                data-testid="workspace-file"
                onClick={() => onSelect(artifact)}
                onDoubleClick={() => onOpen(artifact)}
                className={`flex w-full items-center gap-2 rounded-[8px] py-1.5 pr-2 text-left ${
                  group.directory ? 'pl-[30px]' : 'pl-2'
                } ${selectedId === artifact.id ? 'bg-accent' : 'hover:bg-accent/55'}`}
              >
                <span className="w-6 shrink-0 font-mono text-[8.5px] text-muted-foreground/70">
                  {artifactBadge(artifact)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[10.8px] text-foreground/85">
                  {artifact.name}
                </span>
                <small className="shrink-0 text-[9.5px] text-muted-foreground/65">
                  {relativeTime(artifact.createdAt)}
                </small>
              </button>
            ))}
          </section>
        ))}

        {visible.length === 0 && (
          <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            {artifacts.length === 0 ? '工作区还没有已索引文件' : '没有匹配的工作区文件'}
          </p>
        )}
      </div>
      <div className="border-t px-3 py-2 text-[9.5px] text-muted-foreground/70">
        单击预览 · 双击用系统打开
      </div>
    </div>
  )
}

function FileViewer({
  artifact,
  preview,
  onClose,
  onOpen,
}: {
  artifact: ArtifactRef
  preview?: ArtifactPreviewResult
  onClose(): void
  onOpen(): void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const path = artifact.path ?? artifact.name
  const directory = path.includes('/') || path.includes('\\')
    ? path.split(/[\\/]/).slice(0, -1).join(' / ')
    : '当前工作区'

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-9 z-[80] grid place-items-center bg-black/25 p-7 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section data-testid="file-viewer" className="flex h-[min(670px,90%)] w-[min(780px,92%)] flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_30px_90px_rgba(25,23,20,.30)]">
        <header className="flex min-h-[58px] items-center gap-2.5 border-b px-[13px] py-2.5 pl-[17px]">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <small className="truncate font-mono text-[9.5px] text-muted-foreground/70">{directory}</small>
            <strong className="truncate font-mono text-[11.5px] font-medium">{artifact.name}</strong>
          </div>
          <span className="text-[9.5px] text-muted-foreground">{artifactBadge(artifact)} · {relativeTime(artifact.createdAt)}</span>
          <button type="button" onClick={onOpen} className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border bg-card px-[11px] text-[11.5px] text-foreground/80 hover:bg-accent">
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
            系统打开
          </button>
          <button type="button" aria-label="关闭文件查看器" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto bg-background p-[34px_44px] max-[640px]:p-3">
          <div className="mx-auto min-h-full w-full max-w-[620px] rounded-[10px] border bg-card p-7 shadow-[0_1px_3px_rgba(30,28,24,.04)]">
            {preview?.kind === 'text' ? (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.8] text-foreground/80">{preview.text}</pre>
            ) : (
              <div className="grid min-h-[280px] place-items-center text-center text-[11.5px] text-muted-foreground">
                {preview?.kind === 'binary'
                  ? '该文件不能内联预览，请使用系统应用打开。'
                  : preview?.error ?? '正在准备只读预览…'}
              </div>
            )}
          </div>
        </main>
        <footer className="flex justify-between border-t px-[15px] py-2 text-[9.5px] text-muted-foreground/70">
          <span>只读预览</span>
          <span>内容来自当前工作区 · 自动随文件变化刷新</span>
        </footer>
      </section>
    </div>
  )
}

function groupWorkspaceFiles(artifacts: ArtifactRef[]): Array<{ directory: string; items: ArtifactRef[] }> {
  const map = new Map<string, ArtifactRef[]>()
  for (const artifact of artifacts) {
    const path = artifact.path ?? artifact.name
    const parts = path.split(/[\\/]/)
    const directory = parts.length > 1 ? parts.slice(0, -1).join(' / ') : ''
    const list = map.get(directory) ?? []
    list.push(artifact)
    map.set(directory, list)
  }
  return [...map.entries()].map(([directory, items]) => ({ directory, items }))
}

const EMPTY_HINTS = [
  { icon: FileText, label: '文档与报告', description: 'Markdown、PDF、Word 等' },
  { icon: Code2, label: '代码与脚本', description: '新建或修改过的源文件' },
  { icon: FileImage, label: '图片与图表', description: '生成的视觉结果' },
  { icon: Table2, label: '结构化数据', description: 'CSV、JSON 与表格' },
]

function ResultsEmptyState() {
  return (
    <div className="flex flex-col gap-4 px-4 pb-5 pt-1.5">
      <section className="flex flex-col gap-[7px] rounded-xl bg-card/65 p-3.5 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-muted text-muted-foreground">
          <File className="h-4 w-4" strokeWidth={1.7} />
        </span>
        <strong className="text-[13px] font-medium text-foreground/90">这次任务的产物会出现在这里</strong>
        <p className="m-0 text-[12px] leading-[1.75] text-muted-foreground">
          左边保留 Agent 的执行过程；这里只收纳它写出的文件、生成的图片和改动过的代码。
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <span className="pl-0.5 text-[11px] font-medium tracking-[.07em] text-muted-foreground/70">会自动收纳</span>
        {EMPTY_HINTS.map(({ icon: Icon, label, description }) => (
          <div key={label} className="flex items-center gap-2.5 rounded-[9px] bg-card/30 px-2.5 py-[9px]">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-muted text-muted-foreground/75">
              <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <strong className="text-[12px] font-normal text-foreground/70">{label}</strong>
              <small className="text-[11px] text-muted-foreground/70">{description}</small>
            </span>
          </div>
        ))}
      </section>
    </div>
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
