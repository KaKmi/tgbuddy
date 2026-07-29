import { useState } from 'react'
import type { CompactionMessage, SessionMessage } from '../../shared/types/message.ts'

export function CompactionDivider({
  sessionId,
  message,
}: {
  sessionId: string
  message: CompactionMessage
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [original, setOriginal] = useState<SessionMessage[] | null>(null)

  async function toggleOriginal() {
    if (original) {
      setOriginal(null)
      return
    }
    setLoading(true)
    try {
      setOriginal(await window.tgbuddy.session.compactedMessages(sessionId, message.id))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="h-px flex-1 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.16)_0_5px,transparent_5px_10px)]" />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-[7px] rounded-full bg-[#1c1c1f] px-[11px] py-1 text-[11.5px] text-[#90909a] hover:bg-[#232327]"
        >
          ⇲ 已压缩 {message.compactedCount} 条消息
          <span className="text-[#63636b]">{open ? '▾' : '▸'}</span>
        </button>
        <div className="h-px flex-1 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.16)_0_5px,transparent_5px_10px)]" />
      </div>

      {open && (
        <div className="mx-auto w-full max-w-[720px] rounded-[11px] bg-[#191919] px-[15px] py-[13px]">
          <div className="mb-2 text-[11px] tracking-[.06em] text-[#6d6d75]">
            摘要（Agent 后续只读到这一段）
          </div>
          <div className="whitespace-pre-line text-[12.5px] leading-[1.8] text-[#b6b6bd]">
            {message.summary}
          </div>
          <button
            type="button"
            onClick={() => void toggleOriginal()}
            disabled={loading}
            className="mt-[11px] rounded-[7px] bg-white/[.06] px-2.5 py-[5px] text-[11.5px] text-[#c8c8cf] hover:bg-white/[.11] disabled:opacity-40"
          >
            {loading ? '正在读取…' : original ? '收起原始消息' : `查看原始 ${message.compactedCount} 条消息`}
          </button>

          {original && (
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto border-t border-white/[.06] pt-3">
              {original.map((item) => (
                <OriginalMessage key={item.id} message={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OriginalMessage({ message }: { message: SessionMessage }) {
  if (message.kind !== 'kernel') return null
  const inner = message.message
  if (inner.role === 'assistant') {
    const text = inner.content
      .map((block) => (block.type === 'text' ? block.text : block.type === 'toolCall' ? `[工具] ${block.name}` : ''))
      .filter(Boolean)
      .join('\n')
    return <div className="whitespace-pre-wrap text-xs leading-relaxed text-[#9a9aa2]">Agent：{text}</div>
  }
  if (inner.role === 'user') {
    const text =
      typeof inner.content === 'string'
        ? inner.content
        : inner.content.map((block) => (block.type === 'text' ? block.text : '[图片]')).join('\n')
    return <div className="whitespace-pre-wrap text-xs leading-relaxed text-[#b6b6bd]">用户：{text}</div>
  }
  return <div className="text-xs text-[#777780]">工具结果：{inner.toolName}</div>
}
