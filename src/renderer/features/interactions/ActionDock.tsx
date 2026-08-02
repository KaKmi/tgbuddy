import { ChevronDown, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { HumanInteractionRequest } from '../../../shared/contracts/interaction.ts'
import type {
  AskUserRequest,
  PermissionRequest,
  PlanRequest,
  RuleScope,
} from '../../../shared/contracts/permission.ts'

export function ActionDock({ sessionId }: { sessionId?: string }) {
  const [items, setItems] = useState<HumanInteractionRequest[]>([])

  async function refresh(): Promise<void> {
    if (!sessionId) {
      setItems([])
      return
    }
    const runs = await window.tgbuddy.runs.list(sessionId)
    const latest = runs.reduce(
      (current, run) => (!current || run.createdAt > current.createdAt ? run : current),
      undefined as (typeof runs)[number] | undefined,
    )
    const rootRunId = latest ? (latest.rootRunId ?? latest.id) : undefined
    const pending = rootRunId ? await window.tgbuddy.interaction.pending(rootRunId) : []
    setItems(pending.filter((item) => item.active))
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 500)
    return () => window.clearInterval(timer)
  }, [sessionId])

  const item = items[0]
  if (!item) return null

  const respond = async (response: unknown): Promise<void> => {
    await window.tgbuddy.interaction.respond({
      requestId: item.id,
      response,
      expectedRevision: 1,
    })
    await refresh()
  }

  return (
    <section
      data-testid="action-dock"
      className="mx-auto w-full max-w-[760px] px-5 pb-2"
      aria-label="等待你处理"
    >
      {item.kind === 'permission' && (
        <PermissionCard request={item.payload as PermissionRequest} onRespond={respond} />
      )}
      {item.kind === 'plan' && (
        <PlanApprovalCard request={item.payload as PlanRequest} onRespond={respond} />
      )}
      {item.kind === 'ask_user' && (
        <AskUserStepper request={item.payload as AskUserRequest} onRespond={respond} />
      )}
      {items.length > 1 && (
        <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
          处理后还有 {items.length - 1} 项等待
        </p>
      )}
    </section>
  )
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequest
  onRespond(response: unknown): Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reason, setReason] = useState('')

  const submit = async (response: unknown): Promise<void> => {
    setBusy(true)
    try {
      await onRespond(response)
    } finally {
      setBusy(false)
    }
  }

  const grant = request.suggestedGrants[0]
  return (
    <div className="overflow-hidden rounded-[14px] border border-status-pending/25 bg-card shadow-[0_12px_32px_rgba(30,28,24,.10)]">
      <header className="flex items-start gap-2.5 border-b border-border/70 px-3.5 py-3">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-status-pending/10 text-status-pending">
          <ShieldAlert size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <strong className="text-[12.5px] font-semibold">允许执行 {request.toolName}？</strong>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[9.5px] text-muted-foreground">
              {request.risk === 'high' ? '高危 · 每次确认' : request.risk === 'medium' ? '需授权' : '低风险'}
            </span>
          </div>
          <p className="mt-0.5 text-[10.8px] text-muted-foreground">
            {request.neverPersist ? '该操作不可保存为规则，只能允许一次' : '授权范围只影响当前选择的资源'}
          </p>
        </div>
      </header>
      <pre className="mx-3.5 mt-3 max-h-24 overflow-auto rounded-[9px] bg-muted px-3 py-2 font-mono text-[10.5px] leading-[1.65] text-foreground/70">
        {JSON.stringify(request.args, null, 2)}
      </pre>
      {reasonOpen && (
        <textarea
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="告诉 Agent 为什么拒绝，方便它换一种方式…"
          className="mx-3.5 mt-2 min-h-16 w-[calc(100%-1.75rem)] resize-none rounded-[9px] border bg-background px-3 py-2 text-[11.5px] outline-none focus:ring-2 focus:ring-ring/20"
        />
      )}
      <footer className="flex flex-wrap items-center justify-end gap-2 px-3.5 py-3">
        <button
          disabled={busy}
          onClick={() => void submit({ allowed: true })}
          className="min-h-8 rounded-[9px] bg-primary px-3.5 text-[11.5px] font-medium text-primary-foreground disabled:opacity-50"
        >
          允许一次
        </button>
        {!request.neverPersist && grant && (
          <div className="relative">
            <button
              disabled={busy}
              onClick={() => setScopeOpen((open) => !open)}
              className="inline-flex min-h-8 items-center gap-1 rounded-[9px] border bg-background px-3 text-[11.5px] hover:bg-accent"
            >
              按范围允许 <ChevronDown size={12} />
            </button>
            {scopeOpen && (
              <div className="absolute bottom-10 right-0 z-20 w-44 rounded-[10px] border bg-popover p-1 shadow-xl">
                {(['agent_run', 'session', 'project'] as RuleScope[]).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => void submit({ allowed: true, grant: { match: grant.match, pattern: grant.pattern, scope } })}
                    className="block w-full rounded-[7px] px-2.5 py-2 text-left text-[11px] hover:bg-accent"
                  >
                    {scope === 'agent_run' ? '本次任务' : scope === 'session' ? '本会话' : '本工作区'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          disabled={busy}
          onClick={() => reasonOpen
            ? void submit({ allowed: false, reason: reason.trim() || '用户拒绝了该操作' })
            : setReasonOpen(true)}
          className="min-h-8 rounded-[9px] border bg-background px-3 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {reasonOpen ? '确认拒绝' : '拒绝并说明'}
        </button>
      </footer>
    </div>
  )
}

function AskUserStepper({ request, onRespond }: { request: AskUserRequest; onRespond(response: unknown): Promise<void> }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const question = request.questions[index]!
  const selected = custom.trim() || answers[question.id]

  const next = async (): Promise<void> => {
    if (!selected) return
    const nextAnswers = { ...answers, [question.id]: selected }
    setAnswers(nextAnswers)
    setCustom('')
    if (index < request.questions.length - 1) return setIndex(index + 1)
    setBusy(true)
    await onRespond({
      answers: request.questions.map((item) => ({ questionId: item.id, value: nextAnswers[item.id] ?? '' })),
    })
  }

  return (
    <div className="rounded-[14px] border bg-card px-4 py-3.5 shadow-[0_12px_32px_rgba(30,28,24,.09)]">
      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>{question.header}</span><span>{index + 1} / {request.questions.length}</span>
      </div>
      <h3 className="mt-1.5 text-[13px] font-semibold">{question.question}</h3>
      <div className="mt-3 grid gap-1.5">
        {question.options.map((option) => (
          <button
            key={option.label}
            onClick={() => { setAnswers((current) => ({ ...current, [question.id]: option.label })); setCustom('') }}
            className={`rounded-[10px] border px-3 py-2 text-left ${answers[question.id] === option.label && !custom ? 'border-primary/45 bg-primary/5' : 'bg-background hover:bg-accent'}`}
          >
            <span className="block text-[11.5px] font-medium">{option.label}</span>
            <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{option.description}</span>
          </button>
        ))}
        <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="其他答案…" className="min-h-9 rounded-[9px] border bg-background px-3 text-[11.5px] outline-none focus:ring-2 focus:ring-ring/20" />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {index > 0 && <button onClick={() => setIndex(index - 1)} className="min-h-8 rounded-[9px] border px-3 text-[11px]">上一个</button>}
        <button disabled={!selected || busy} onClick={() => void next()} className="min-h-8 rounded-[9px] bg-primary px-3.5 text-[11.5px] text-primary-foreground disabled:opacity-40">
          {index === request.questions.length - 1 ? '提交回答' : '下一个'}
        </button>
      </div>
    </div>
  )
}

function PlanApprovalCard({ request, onRespond }: { request: PlanRequest; onRespond(response: unknown): Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const [reason, setReason] = useState('')
  const [revising, setRevising] = useState(false)
  return (
    <div className="rounded-[14px] border bg-card px-4 py-3.5 shadow-[0_12px_32px_rgba(30,28,24,.09)]">
      <div className="flex items-center justify-between gap-3"><strong className="text-[12.5px]">计划已准备好</strong><span className="text-[10.5px] text-muted-foreground">批准后开始执行</span></div>
      <p className="mt-2 rounded-[9px] bg-muted px-3 py-2 text-[11.5px] leading-relaxed text-foreground/75">{planSummary(request.plan)}</p>
      <div className="mt-2 space-y-1">
        {request.effects.map((effect, index) => (
          <div key={`${effect.tool}:${effect.match}:${effect.pattern}:${index}`} className="flex items-center gap-2 rounded-[8px] bg-muted/70 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
            <code>{effect.tool}</code>
            <span className="truncate">{effect.pattern}</span>
            <span className="ml-auto shrink-0">{effect.maxRisk}</span>
          </div>
        ))}
      </div>
      <button onClick={() => setExpanded(!expanded)} className="mt-1.5 text-[10.8px] text-muted-foreground hover:text-foreground">{expanded ? '收起完整计划' : '查看完整计划'}</button>
      {expanded && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[9px] bg-muted p-3 text-[10.5px] leading-[1.65]">{request.plan}</pre>}
      {revising && <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="需要怎么修改？" className="mt-2 min-h-16 w-full resize-none rounded-[9px] border bg-background px-3 py-2 text-[11.5px]" />}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => void onRespond({ approved: true })} className="min-h-8 rounded-[9px] bg-primary px-3.5 text-[11.5px] text-primary-foreground">批准并执行</button>
        <button onClick={() => revising ? void onRespond({ approved: false, reason }) : setRevising(true)} className="min-h-8 rounded-[9px] border px-3 text-[11.5px]">{revising ? '提交修改意见' : '要求修改'}</button>
      </div>
    </div>
  )
}

function planSummary(plan: string): string {
  const first = plan.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? plan
  return first.length > 180 ? `${first.slice(0, 177)}…` : first
}
