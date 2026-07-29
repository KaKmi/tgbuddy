/**
 * Conversation —— 会自动黏底的滚动容器。
 *
 * 移植自 Vercel AI Elements 的 `conversation.tsx`，去掉了它对 shadcn Button 和
 * AI SDK `UIMessage` 的依赖，其余保持原样。
 *
 * ## 为什么值得搬这一个
 *
 * 「流式输出时自动滚到底，但用户往上翻的时候不要抢滚动条」——
 * 这个需求看着简单，自己写会踩一串坑：判断"用户是否主动滚开了"、
 * 内容高度变化时的抖动、`scrollIntoView` 每帧调用导致的卡顿。
 *
 * 我们原来的实现是每个 delta 都 `bottomRef.scrollIntoView({behavior:'smooth'})`，
 * 既卡又会在用户回看历史时把人拽回底部。
 *
 * `use-stick-to-bottom` 用 ResizeObserver + 速度曲线做这件事，是解决过的问题。
 */

import { ArrowDownIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useCallback } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { cn } from '../../lib/utils.ts'

export type ConversationProps = ComponentProps<typeof StickToBottom>

/**
 * ⚠️ `min-h-0` 不能省。
 *
 * 经典 flexbox 陷阱：flex 子项默认 `min-height: auto`，会被内容撑开而不是被父容器约束。
 * 结果是这个容器长到和内容一样高，内部的 `height: 100%` 滚动区永远不会溢出 —— 滚不动。
 * 加 `min-h-0` 才让它老老实实只占父容器分给它的高度。
 */
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn('relative flex-1 min-h-0 overflow-hidden', className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
)

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

/**
 * ⚠️ `StickToBottom.Content` 内部渲染**两层 div**：
 *   外层（`height:100%`）是真正的滚动容器，接 `scrollClassName`
 *   内层才接 `className`（也就是普通的 props 透传）
 *
 * 所以布局类名给 `className`，滚动行为必须给 `scrollClassName` —— 给错层就滚不动。
 * 库本身会在 effect 里检测到 `overflow: visible` 时自动设成 auto，
 * 但显式声明更可靠，也省得读代码的人去猜。
 */
export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    scrollClassName="overflow-y-auto"
    className={cn('flex flex-col gap-4 p-4', className)}
    {...props}
  />
)

/**
 * 「回到底部」按钮。只在用户滚开时出现 —— 这是黏底交互的必要配套，
 * 否则用户往上翻之后就失去了回到最新内容的快捷方式。
 */
export const ConversationScrollButton = ({ className, ...props }: ComponentProps<'button'>) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  const handleClick = useCallback(() => void scrollToBottom(), [scrollToBottom])

  if (isAtBottom) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border',
        'bg-accent p-2 text-foreground/80 shadow-lg transition-colors hover:bg-accent',
        className,
      )}
      aria-label="回到底部"
      {...props}
    >
      <ArrowDownIcon className="h-4 w-4" />
    </button>
  )
}

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string
  description?: string
  icon?: React.ReactNode
}

/**
 * 空状态。设计文档里特别强调过：**这不是边缘情况**，
 * 用户看它的次数比看任何具体内容都多（docs/06 决定 6）。
 */
export const ConversationEmptyState = ({
  className,
  title = '还没有消息',
  description = '说点什么开始',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-foreground/80">{title}</h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </>
    )}
  </div>
)
