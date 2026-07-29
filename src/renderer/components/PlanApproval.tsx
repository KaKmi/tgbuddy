/**
 * 计划审批卡片。
 *
 * 和权限确认同构（都靠 `PendingRequests` 挂起），但语义不同：
 * **拒绝不等于放弃**，而是「按我的意见改了再来」。所以拒绝时提供一个
 * 意见输入框，内容会作为工具结果回给模型。
 */

import { useState } from 'react'
import type { PlanRequest } from '../../shared/types/permission.ts'
import { Response } from './ai-elements/response.tsx'

export function PlanApproval({ request }: { request: PlanRequest }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

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
        background: 'rgba(157,191,224,.045)',
        boxShadow: 'inset 0 0 0 1px rgba(157,191,224,.22)',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[13px] font-medium" style={{ color: '#9dbfe0' }}>
          计划待审批
        </span>
        <span className="text-[11.5px] text-muted-foreground/70">
          批准后退出计划模式开始执行
        </span>
      </div>

      <div className="px-3 pb-2">
        <Response className="prose-p:my-1.5">{request.plan}</Response>
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

      <div className="flex gap-2 px-3 pb-3">
        <button
          disabled={busy}
          onClick={() => void respond(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          批准并执行
        </button>
        {rejecting ? (
          <button
            disabled={busy}
            onClick={() => void respond(false)}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-foreground/80 hover:bg-accent/70 disabled:opacity-40"
          >
            提交意见
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-foreground/80 hover:bg-accent/70 disabled:opacity-40"
          >
            要修改
          </button>
        )}
      </div>
    </div>
  )
}
