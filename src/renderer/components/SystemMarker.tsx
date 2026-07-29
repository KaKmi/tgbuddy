/**
 * 系统标记 —— 对话流里那些「不是对话内容、但用户需要知道」的事件。
 *
 * 切换专家、进入计划模式、上下文压缩、重试 —— 共用这一套视觉语言。
 * 规格逐项对齐交互原型（docs/06-设计决策.md 决定 2.5）。
 *
 * ## 为什么长这样
 *
 * 标记不是对话内容，所以**不用气泡、不占对话缩进**；但要能被扫到，
 * 所以用**一条向右淡出的细线**把它和消息区分开。
 *
 * 字形徽标而不是彩色图标 —— 避免和工具卡片的状态色抢注意力。
 *
 * 有细节的（压缩、切换专家）可展开，纯事实的（模式变更、重试）不可展开。
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
      <div className="flex items-center gap-[9px] text-xs" style={{ color: '#7a7a82' }}>
        <span
          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-md text-[11px]"
          style={{ background: 'rgba(255,255,255,.05)', color }}
        >
          {glyph}
        </span>
        <span style={{ color: '#8e8e96' }}>{text}</span>

        {expandable && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="cursor-pointer underline underline-offset-[3px]"
            style={{ color: '#6b6b73', textDecorationColor: 'rgba(255,255,255,.18)' }}
          >
            {open ? '收起' : (toggleLabel ?? '展开')}
          </button>
        )}

        {/* 向右淡出的细线：把标记和消息区分开，又不像分割线那样割裂 */}
        <div
          className="h-px flex-1"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,.08), rgba(255,255,255,0))',
          }}
        />
      </div>

      {open && detail && (
        <div
          className={cn('ml-[27px] whitespace-pre-line rounded-[10px] px-[13px] py-[11px] text-xs')}
          style={{ background: '#191919', color: '#97979e', lineHeight: 1.75 }}
        >
          {detail}
        </div>
      )}
    </div>
  )
}

/** 各类标记的字形与配色，取自原型 */
export const MARKER_STYLE = {
  expert_changed: { glyph: '⇄', color: '#b0a2e0' },
  mode_changed: { glyph: '⊞', color: '#9dbfe0' },
  retry: { glyph: '↻', color: '#e0a33e' },
  compaction: { glyph: '⇲', color: '#8fc6a5' },
  session_resumed: { glyph: '◇', color: '#9dbfe0' },
} as const

export type MarkerKind = keyof typeof MARKER_STYLE
