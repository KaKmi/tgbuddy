import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { Ref } from 'react'

interface ConversationHeaderProps {
  title: string
  running: boolean
  resultsOpen: boolean
  onToggleResults(): void
  resultsToggleRef?: Ref<HTMLButtonElement>
}

/** 会话级状态只在 Header 汇总，避免把运行提示散落到对话正文。 */
export function ConversationHeader({
  title,
  running,
  resultsOpen,
  onToggleResults,
  resultsToggleRef,
}: ConversationHeaderProps) {
  const ResultsIcon = resultsOpen ? PanelRightClose : PanelRightOpen

  return (
    <header
      data-testid="conversation-header"
      className="flex h-12 shrink-0 items-center gap-3 border-b px-[18px]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <h1
          data-testid="conversation-title"
          className="truncate text-[13px] font-semibold text-foreground"
        >
          {title}
        </h1>
        {running && (
          <span
            data-testid="run-pill"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-status-running/10 px-2 py-1 text-[10.5px] text-status-running"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-info" />
            正在运行
          </span>
        )}
      </div>
      <button
        ref={resultsToggleRef}
        type="button"
        data-testid="results-toggle"
        aria-label={resultsOpen ? '收起结果区' : '展开结果区'}
        aria-pressed={resultsOpen}
        onClick={onToggleResults}
        className={`inline-flex h-[29px] items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] transition-colors ${resultsOpen ? 'border-border bg-card text-foreground' : 'border-transparent bg-muted text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'}`}
      >
        <ResultsIcon aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
        <span>结果与文件</span>
      </button>
    </header>
  )
}
