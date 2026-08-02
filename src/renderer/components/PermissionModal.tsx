/**
 * 高危不可逆操作的模态确认（docs/06 决定 3）。
 *
 * 只用于 `requiresModal` 的请求：当前来源是 bash 破坏性命令（rm/sudo/…）
 * 与 delete 工具。普通 ask 永远走 inline 卡片，不打断会话心流。
 *
 * 关闭（✕）只是收起模态，请求仍然挂起 —— 会退化为 inline 卡片继续可答。
 * 这类操作永远不能进入「总是允许」，所以这里没有规则候选。
 */

import { useEffect, useState } from 'react'
import type { PermissionRequest } from '../../shared/types/permission.ts'

export function PermissionModal({
  request,
  onClose,
}: {
  request: PermissionRequest
  onClose(): void
}) {
  const [denyOpen, setDenyOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function respond(allowed: boolean) {
    if (busy) return
    setBusy(true)
    await window.tgbuddy.permission.respond({
      requestId: request.requestId,
      allowed,
      ...(
        allowed
          ? {}
          : { reason: reason.trim() || '用户拒绝了该操作，请换一种方式或询问用户' }
      ),
    })
  }

  // 原型快捷键：Esc 拒绝。请求不能因关闭而被丢弃，所以 Esc 是显式拒绝。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) void respond(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy])

  const command =
    typeof request.args.command === 'string'
      ? request.args.command
      : Array.isArray(request.args.paths)
        ? request.args.paths.join('、')
        : JSON.stringify(request.args)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(6,6,8,.62)', backdropFilter: 'blur(3px)' }}
    >
      <div
        className="flex w-[520px] flex-col gap-[14px] rounded-[14px] p-5"
        style={{
          background: '#1e1e21',
          boxShadow: '0 32px 90px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.08)',
        }}
      >
        <div className="flex items-center gap-[10px]">
          <div
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px]"
            style={{ background: 'rgba(201,99,91,.16)', color: '#e5a49d' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.3 3.9 2.5 17.5A1.7 1.7 0 0 0 4 20h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0z" />
            </svg>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[15px] font-medium text-[#f2f2f4]">
              {request.toolName === 'delete' ? '确认删除文件？' : '确认执行高危命令？'}
            </div>
            <div className="text-xs text-[#8a8a92]">高危 · 不可逆</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[#7d7d85] transition-colors hover:bg-white/[.07]"
            title="收起（请求仍等待处理）"
          >
            ✕
          </button>
        </div>

        <div
          className="overflow-auto rounded-[9px] p-[11px_13px] font-mono text-[11.5px] leading-[1.8] text-[#cfcfd6]"
          style={{ background: '#141416' }}
        >
          {request.toolName === 'bash' ? `$ ${command}` : command}
        </div>

        <div className="flex flex-col gap-1.5 text-xs leading-[1.7] text-[#9a9aa2]">
          {request.affectedPaths?.map((path) => (
            <div key={path}>· {path}</div>
          ))}
          <div>· 该操作不可逆，永远不能进入「总是允许」</div>
        </div>

        {denyOpen ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="告诉 Agent 为什么不行（可跳过，填了它会换方案而不是死循环重试）"
              className="min-h-[54px] resize-none rounded-[8px] border-none p-[9px_11px] text-[12.5px] leading-[1.6] text-[#e6e6ea] outline-none"
              style={{ background: '#141416' }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(false)}
                className="rounded-[7px] px-[13px] py-[6px] text-xs text-white disabled:opacity-50"
                style={{ background: 'rgba(201,99,91,.9)' }}
              >
                拒绝并发送
              </button>
              <button
                type="button"
                onClick={() => setDenyOpen(false)}
                className="rounded-[7px] px-3 py-1.5 text-xs text-[#8a8a92]"
              >
                返回
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond(true)}
              className="rounded-[8px] px-[15px] py-2 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ background: '#c9635b' }}
            >
              允许执行
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDenyOpen(true)}
              className="rounded-[8px] px-[14px] py-2 text-[13px] text-[#e6e6ea] disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,.08)' }}
            >
              拒绝并说明
            </button>
            <span className="ml-auto text-[11px] text-[#75757e]">
              模态只用于高危+不可逆
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
