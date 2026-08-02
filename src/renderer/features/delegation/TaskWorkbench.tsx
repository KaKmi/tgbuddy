import { Bot, CircleStop, LoaderCircle, Search, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DelegationTask, DelegationTaskStatus } from '../../../shared/contracts/delegation.ts'
import type { HumanInteractionRequest } from '../../../shared/contracts/interaction.ts'
import { roleOf, type SessionMessage } from '../../../shared/types/message.ts'

const ACTIVE_STATUSES = new Set<DelegationTaskStatus>(['queued', 'starting', 'running', 'stopping'])

export function TaskWorkbench({
  sessionId,
  tasks,
  onRefreshTasks,
}: {
  sessionId?: string
  tasks: DelegationTask[]
  onRefreshTasks(): Promise<void>
}) {
  const [interactions, setInteractions] = useState<HumanInteractionRequest[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [stopping, setStopping] = useState(false)

  async function refreshInteractions(): Promise<void> {
    if (!sessionId) return
    setInteractions(await window.tgbuddy.interaction.pending())
  }

  useEffect(() => {
    setMessages([])
    setSelectedId(undefined)
    setInteractions([])
    if (!sessionId) return
    void refreshInteractions()
    const timer = window.setInterval(() => void refreshInteractions(), 800)
    return () => window.clearInterval(timer)
  }, [sessionId])

  const selected = tasks.find((task) => task.id === selectedId)

  useEffect(() => {
    setMessages([])
    if (!selectedId) return
    void window.tgbuddy.delegation.messages(selectedId).then(setMessages)
  }, [selectedId, selected?.lastActivityAt])

  const groups = useMemo(() => groupTasks(tasks), [tasks])
  const attention = interactions.find((item) => item.source.taskId === selectedId)

  if (!sessionId) return <TaskEmptyState message="当前会话还没有可展示的运行任务" />
  if (tasks.length === 0) return <TaskEmptyState message="主 Agent 分派任务后，子 Agent 会显示在这里" />

  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="task-detail">
        <header className="shrink-0 border-b px-3.5 py-3">
          <button type="button" onClick={() => setSelectedId(undefined)} className="mb-2 text-[10.5px] text-muted-foreground hover:text-foreground">
            ← 返回任务列表
          </button>
          <div className="flex items-start gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-muted text-muted-foreground">
              {selected.role === 'explorer' ? <Search size={15} /> : <Wrench size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <strong className="truncate text-[12px]">{selected.title}</strong>
                <TaskStatus status={selected.status} attention={Boolean(attention)} />
              </div>
              <p className="mt-1 line-clamp-3 text-[10.5px] leading-relaxed text-muted-foreground">{selected.task}</p>
            </div>
          </div>
          {ACTIVE_STATUSES.has(selected.status) && (
            <button
              type="button"
              disabled={stopping}
              onClick={async () => {
                setStopping(true)
                try {
                  await window.tgbuddy.delegation.stop(selected.id)
                  await Promise.all([onRefreshTasks(), refreshInteractions()])
                } finally {
                  setStopping(false)
                }
              }}
              className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[10.8px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <CircleStop size={13} /> 停止任务
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <div className="grid min-h-36 place-items-center text-[10.8px] text-muted-foreground">
              {ACTIVE_STATUSES.has(selected.status) ? '子 Agent 正在准备执行记录…' : '没有可展示的执行记录'}
            </div>
          ) : (
            <div className="space-y-2.5">
              {messages.map((message, index) => <TaskMessage key={messageKey(message, index)} message={message} />)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-2.5 py-2" data-testid="task-list">
      {groups.map((group) => (
        <section key={group.label} className="mb-3">
          <h3 className="px-1.5 py-1.5 text-[10px] font-semibold tracking-[.06em] text-muted-foreground/75">{group.label} · {group.tasks.length}</h3>
          <div className="space-y-1">
            {group.tasks.map((task) => {
              const taskAttention = interactions.some((item) => item.source.taskId === task.id)
              return (
                <button key={task.id} type="button" onClick={() => setSelectedId(task.id)} className="flex w-full items-start gap-2.5 rounded-[10px] p-2.5 text-left hover:bg-accent/65">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-muted text-muted-foreground">
                    {ACTIVE_STATUSES.has(task.status) ? <LoaderCircle className="animate-spin" size={14} /> : <Bot size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <strong className="truncate text-[11.5px] font-medium">{task.title}</strong>
                      <TaskStatus status={task.status} attention={taskAttention} />
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                      {task.role === 'explorer' ? '探索 Agent' : '执行 Agent'} · {relativeTime(task.lastActivityAt)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function TaskStatus({ status, attention }: { status: DelegationTaskStatus; attention: boolean }) {
  if (attention) return <span className="shrink-0 rounded-full bg-status-pending/12 px-2 py-0.5 text-[9px] text-status-pending">等待授权</span>
  const label: Record<DelegationTaskStatus, string> = {
    queued: '排队中', starting: '启动中', running: '进行中', stopping: '停止中',
    stopped: '已停止', completed: '已完成', failed: '失败', interrupted: '已中断',
  }
  const tone = status === 'failed'
    ? 'bg-destructive/10 text-destructive'
    : ACTIVE_STATUSES.has(status) ? 'bg-status-running/10 text-status-running' : 'bg-muted text-muted-foreground'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] ${tone}`}>{label[status]}</span>
}

function TaskMessage({ message }: { message: SessionMessage }) {
  const role = roleOf(message)
  return (
    <article className="rounded-[10px] border bg-card px-3 py-2.5">
      <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
        {role === 'assistant' ? '子 Agent' : role === 'user' ? '任务输入' : role}
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-[10.8px] leading-[1.65] text-foreground/75">{messageText(message)}</pre>
    </article>
  )
}

function messageText(message: SessionMessage): string {
  const value = message as unknown as Record<string, unknown>
  const kernelMessage = value.kind === 'kernel' && isRecord(value.message)
    ? value.message
    : value
  return contentText(kernelMessage.content) || '（无可展示内容）'
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (!isRecord(part)) return ''
    if (typeof part.text === 'string') return part.text
    if (typeof part.name === 'string') return `调用工具：${part.name}`
    return ''
  }).filter(Boolean).join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function messageKey(message: SessionMessage, index: number): string {
  const value = message as unknown as Record<string, unknown>
  return typeof value.id === 'string' ? value.id : `${roleOf(message)}-${index}`
}

function groupTasks(tasks: DelegationTask[]) {
  return [
    { label: '进行中', tasks: tasks.filter((task) => ACTIVE_STATUSES.has(task.status)) },
    { label: '已完成', tasks: tasks.filter((task) => task.status === 'completed') },
    { label: '已停止 / 异常', tasks: tasks.filter((task) => ['stopped', 'failed', 'interrupted'].includes(task.status)) },
  ].filter((group) => group.tasks.length > 0)
}

function TaskEmptyState({ message }: { message: string }) {
  return (
    <div className="grid h-full min-h-72 place-items-center px-8 text-center">
      <div>
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground"><Bot size={17} /></span>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`
}
