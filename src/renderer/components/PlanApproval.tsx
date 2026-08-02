/**
 * 计划审批卡片。
 *
 * 和权限确认同构（都靠 `PendingRequests` 挂起），但语义不同：
 * **拒绝不等于放弃**，而是「按我的意见改了再来」。所以拒绝时提供一个
 * 意见输入框，内容会作为工具结果回给模型。
 *
 * 展示按 Codex 的设计收口：首屏只给 TL;DR 摘要，完整计划折叠，
 * 用户需要时再展开——批准前能快速判断，又不把长计划糊一脸。
 */

import { useState } from 'react'
import type { PlanRequest } from '../../shared/types/permission.ts'
import { Response } from './ai-elements/response.tsx'

/** 取计划正文的 TL;DR：第一个非空段落（截到 160 字，超长截断加省略号） */
function planSummary(plan: string): string {
  const first = plan
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const text = first ?? plan
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

export function PlanApproval({ request }: { request: PlanRequest }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function respond(approved: boolean) {
    setBusy(true)
    await window.tgbuddy.plan.respond({
      requestId: request.requestId,
      approved,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    })
  }

  return (
    <div
      className="max-w-[720px] overflow-hidden"
      style={{
        borderRadius: 11,
        background: 'color-mix(in srgb, hsl(var(--status-running)) 7%, hsl(var(--card)))',
        boxShadow: 'inset 0 0 0 1px hsl(var(--status-running) / .22)',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[13px] font-medium text-status-running">
          计划待审批
        </span>
        <span className="text-[11.5px] text-muted-foreground/70">
          批准后退出计划模式开始执行
        </span>
      </div>

      <div className="px-3 pb-2">
        <div className="rounded-lg bg-muted px-2.5 py-2 text-[12px] leading-relaxed text-foreground/85">
          {planSummary(request.plan)}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1.5 text-[11px] text-status-running hover:text-foreground"
        >
          {expanded ? '▾ 收起完整计划' : '▸ 查看完整计划'}
        </button>
        {expanded && (
          <div className="mt-1.5">
            <Response className="prose-p:my-1.5">{request.plan}</Response>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="px-3 pb-2">
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="说明要改什么，这段会直接给到模型…"
            className="w-full resize-none rounded-lg bg-card px-2.5 py-2 text-xs outline-none ring-1 ring-border focus:ring-ring/40"
          />
        </div>
      )}

      <div className="flex justify-end gap-2 px-3 pb-3">
        <button
          disabled={busy}
          onClick={() => void respond(true)}
          className="inline-flex min-h-[30px] items-center rounded-lg border border-primary bg-primary px-3 text-[11.5px] font-medium text-primary-foreground hover:brightness-110 disabled:opacity-40"
        >
          批准并执行
        </button>
        {rejecting ? (
          <button
            disabled={busy}
            onClick={() => void respond(false)}
            className="inline-flex min-h-[30px] items-center rounded-lg border bg-card px-3 text-[11.5px] text-foreground/80 hover:bg-accent disabled:opacity-40"
          >
            提交意见
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="inline-flex min-h-[30px] items-center rounded-lg border bg-card px-3 text-[11.5px] text-foreground/80 hover:bg-accent disabled:opacity-40"
          >
            要修改
          </button>
        )}
      </div>
    </div>
  )
}
