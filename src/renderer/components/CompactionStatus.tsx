import { useEffect, useState } from 'react'
import type { StreamState } from '../atoms/agent.ts'

export function CompactionStatus({
  sessionId,
  state,
}: {
  sessionId: string
  state: NonNullable<StreamState['compaction']>
}) {
  const [, refresh] = useState(0)
  useEffect(() => {
    if (state.status !== 'scheduled') return
    const timer = setInterval(() => refresh((value) => value + 1), 200)
    return () => clearInterval(timer)
  }, [state.status])

  if (state.status === 'scheduled') {
    const seconds = Math.max(1, Math.ceil(((state.deadlineAt ?? Date.now()) - Date.now()) / 1_000))
    return (
      <div className="mx-auto flex w-full max-w-[720px] items-center gap-3 rounded-[11px] bg-[#191919] px-3.5 py-3 text-[12.5px] text-[#d3d3d9]">
        <span className="h-2 w-2 rounded-full bg-[#e0a33e]" />
        上下文接近上限，{seconds} 秒后自动压缩
        <button
          type="button"
          onClick={() => void window.tgbuddy.compaction.defer(sessionId)}
          className="ml-auto rounded-[7px] bg-white/[.06] px-2.5 py-[5px] text-[11.5px] text-[#b9b9c0] hover:bg-white/[.11]"
        >
          稍后
        </button>
      </div>
    )
  }

  if (state.status === 'queued') {
    return (
      <div className="mx-auto w-full max-w-[720px] rounded-[11px] bg-[#191919] px-3.5 py-3 text-[12.5px] text-[#a6a6ae]">
        当前任务完成后将压缩历史消息
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] items-center gap-[11px] rounded-[11px] bg-[#191919] px-3.5 py-3">
      <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/[.14] border-t-[#cfcfd6]" />
      <div className="flex flex-1 flex-col gap-[5px]">
        <div className="text-[12.5px] text-[#d3d3d9]">
          正在压缩历史消息…（{state.compactedCount ?? 0} 条 → 摘要）
        </div>
        <div className="h-[3px] overflow-hidden rounded bg-white/[.07]">
          <div className="h-full w-[46%] animate-pulse bg-gradient-to-r from-[#5b6b8a] to-[#9dbfe0]" />
        </div>
        <div className="text-[11px] text-[#6d6d75]">你可以继续输入，消息会在压缩完成后发出</div>
      </div>
      <button
        type="button"
        onClick={() => void window.tgbuddy.compaction.cancel(sessionId)}
        className="rounded-[7px] bg-white/[.06] px-2.5 py-[5px] text-[11.5px] text-[#b9b9c0] hover:bg-white/[.11]"
      >
        取消
      </button>
    </div>
  )
}
