import { useState } from 'react'
import type { ContextUsage, ContextUsageBreakdown } from '../../shared/types/context.ts'

interface ContextRow {
  key: keyof ContextUsageBreakdown
  label: string
  color: string
  tokens: number
}

const ROWS: { key: keyof ContextUsageBreakdown; label: string; color: string }[] = [
  { key: 'systemPrompt', label: '系统提示词', color: '#6d6d78' },
  { key: 'tools', label: '工具及子智能体', color: '#7fa7d4' },
  { key: 'messages', label: '对话消息', color: '#e0a33e' },
  { key: 'skills', label: '技能', color: '#b0a2e0' },
  { key: 'mcp', label: '连接器及 MCP', color: '#8fc6a5' },
]

export function buildContextRows(usage: ContextUsage): ContextRow[] {
  return ROWS.map((row) => ({ ...row, tokens: usage.breakdown[row.key] }))
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}

export function ContextUsagePanel({
  sessionId,
  usage,
  disabled,
}: {
  sessionId: string
  usage: ContextUsage
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const rows = buildContextRows(usage)
  const visibleRows = rows.filter((row) => row.tokens > 0)
  const safePercent = Math.max(0, Math.min(usage.percent, 100))

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 items-center gap-[7px] rounded-lg bg-[rgba(224,163,62,.10)] px-2.5 text-xs text-[#d7c9a9] transition-[filter] hover:brightness-125"
        aria-label="查看上下文用量"
        aria-expanded={open}
      >
        <span
          className="h-[9px] w-[9px] rounded-full"
          style={{
            background: `conic-gradient(#e0a33e 0 ${safePercent}%, rgba(255,255,255,.16) ${safePercent}% 100%)`,
          }}
        />
        {usage.percent.toFixed(1)}%
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div data-testid="context-usage-popover" className="absolute bottom-[calc(100%+10px)] right-0 z-30 flex w-[396px] max-w-[calc(100vw-2rem)] flex-col gap-[13px] rounded-[13px] border bg-popover px-4 py-[15px] text-popover-foreground shadow-[0_22px_60px_rgba(0,0,0,.24)]">
            <div className="flex items-baseline gap-[9px]">
              <span className="text-[22px] font-medium tracking-[-.01em] text-foreground">
                {usage.percent.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">
                已使用 {formatTokens(usage.usedTokens)} / {formatTokens(usage.contextWindow)}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto h-[22px] w-[22px] rounded-md text-muted-foreground hover:bg-foreground/[.07]"
                aria-label="关闭上下文用量"
              >
                ×
              </button>
            </div>

            <div className="flex h-[7px] overflow-hidden rounded bg-foreground/[.08]">
              {visibleRows.map((row) => (
                <div
                  key={row.key}
                  className="h-full"
                  style={{
                    width: usage.usedTokens > 0 ? `${(row.tokens / usage.usedTokens) * 100}%` : '0%',
                    background: row.color,
                  }}
                />
              ))}
            </div>

            <div className="flex flex-col gap-0.5">
              {visibleRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-[9px] rounded-[7px] px-[7px] py-1.5 hover:bg-foreground/[.045]"
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-sm"
                    style={{ background: row.color }}
                  />
                  <span className="flex-1 text-[12.5px] text-foreground/85">{row.label}</span>
                  <span className="font-mono text-[11.5px] text-muted-foreground">
                    {formatTokens(row.tokens)}
                  </span>
                </div>
              ))}
              <p className="px-[7px] pt-1 text-[10.5px] text-muted-foreground/70">
                当前窗口总量来自模型回报，分类为本地估算。
              </p>
            </div>

            <div className="h-px bg-border" />

            <div className="flex flex-col gap-[9px]">
              <div className="flex items-center gap-2 text-[12.5px] text-foreground/85">
                <span>自动压缩阈值</span>
                <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">85%</span>
              </div>
              <div className="relative h-1 rounded-[3px] bg-foreground/[.09]">
                <div className="absolute inset-y-0 left-0 w-[85%] rounded-[3px] bg-[rgba(224,163,62,.55)]" />
                <div className="absolute left-[85%] top-[-4px] ml-[-6px] h-3 w-3 rounded-full bg-[#e8e8ec] shadow-[0_1px_4px_rgba(0,0,0,.5)]" />
                <div
                  className="absolute top-[-3px] h-[10px] w-0.5 bg-[#9dbfe0]"
                  style={{ left: `${safePercent}%` }}
                />
              </div>
              <p className="text-[11.5px] leading-[1.65] text-muted-foreground">
                到 85% 自动压缩，触发前 3 秒可以选择「稍后」；也可随时手动压缩。
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void window.tgbuddy.compaction.start(sessionId)
                    setOpen(false)
                  }}
                  disabled={disabled}
                  className="rounded-lg bg-foreground/[.08] px-[13px] py-[7px] text-[12.5px] text-foreground hover:bg-foreground/[.14] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  立即压缩对话消息
                </button>
                {disabled && <span className="text-[11px] text-muted-foreground">任务或压缩进行中</span>}
              </div>
            </div>

            <div className="text-right font-mono text-[10.5px] text-muted-foreground/70">
              最近输出 {formatTokens(usage.outputTokens)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
