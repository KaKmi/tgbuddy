/**
 * 系统标记 —— 对话流里那些「不是对话内容、但用户需要知道」的事件。
 *
 * 切换专家、上下文压缩、重试 —— 共用这一套视觉语言。
 * 规格逐项对齐交互原型（docs/06-设计决策.md 决定 2.5）。
 *
 * ## 为什么长这样
 *
 * 标记不是对话内容，所以**不用气泡、不占对话缩进**；但要能被扫到，
 * 所以用**一条向右淡出的细线**把它和消息区分开。
 *
 * 字形徽标而不是彩色图标 —— 避免和工具卡片的状态色抢注意力。
 *
 * 有细节的（压缩、切换专家）可展开，纯事实的（重试）不可展开。
 */

import { cn } from '../lib/utils.ts'
import { useState } from 'react'

export interface SystemMarkerProps {
  /** 字形徽标，如 ⇄ ⊞ ↻ ⇲ */
  glyph: string
  /** 徽标颜色。取自原型的语义色 */
  color: string
  text: string
  /** 有细节才可展开 */
  detail?: string
  /** 展开按钮的文案，如「查看变化」「查看摘要」 */
  toggleLabel?: string
}

export function SystemMarker({ glyph, color, text, detail, toggleLabel }: SystemMarkerProps) {
  const [open, setOpen] = useState(false)
  const expandable = Boolean(detail)

  return (
    <div className="flex flex-col gap-1.5 pb-2.5 pt-2">
      <div className="flex items-center gap-[9px] text-[11px] text-muted-foreground">
        <span
          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-md text-[11px]"
          style={{ background: 'hsl(var(--muted))', color }}
        >
          {glyph}
        </span>
        <span>{text}</span>

        {expandable && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="cursor-pointer text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-foreground"
          >
            {open ? '收起' : (toggleLabel ?? '展开')}
          </button>
        )}

        {/* 向右淡出的细线：把标记和消息区分开，又不像分割线那样割裂 */}
        <div
          className="h-px flex-1"
          style={{ background: 'linear-gradient(90deg, hsl(var(--border)), transparent)' }}
        />
      </div>

      {open && detail && (
        <div
          className={cn('ml-[27px] whitespace-pre-line rounded-[9px] bg-muted px-3 py-2.5 text-[11.5px] leading-[1.7] text-muted-foreground')}
        >
          {detail}
        </div>
      )}
    </div>
  )
}

/** 各类标记的字形与配色，取自原型 */
export const MARKER_STYLE = {
  expert_changed: { glyph: '⇄', color: 'hsl(var(--status-skill))' },
  retry: { glyph: '↻', color: 'hsl(var(--status-pending))' },
  compaction: { glyph: '⇲', color: 'hsl(var(--status-success))' },
  session_resumed: { glyph: '◇', color: 'hsl(var(--status-running))' },
} as const

export type MarkerKind = keyof typeof MARKER_STYLE
