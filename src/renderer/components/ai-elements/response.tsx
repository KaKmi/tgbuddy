/**
 * Response —— 流式 Markdown 渲染。
 *
 * ## 为什么不是直接用 react-markdown
 *
 * 流式输出时，任意一帧的文本都可能是**语法不完整的**：代码围栏只写了开头三个反引号、
 * 表格写到一半、链接的 `]` 还没出现。直接喂给 react-markdown 会每帧解析出完全不同的
 * DOM 结构 —— 表现就是疯狂闪烁重排，而且代码块内容会被当成正文渲染出来。
 *
 * `streamdown`（Vercel AI Elements 用的那个）专门解决这个：它内部用 `remend`
 * 把未闭合的语法补齐再解析，所以流式过程中结构是稳定的。
 *
 * ## 我们只取这一个组件
 *
 * AI Elements 的 registry 整包会拖进 18 个 npm 依赖（`@xyflow/react`、`media-chrome`、
 * Rive WebGL…）和 24 个 shadcn 组件。它的 `message.tsx` 还绑死了 AI SDK 的 `UIMessage`
 * 类型，跟我们的消息格式对不上。
 *
 * 所以只装 `streamdown` 本体，自己写这层薄封装 —— 拿到全部核心价值，不背包袱。
 */

import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '../../lib/utils.ts'

export interface ResponseProps {
  children: string
  /** 流式进行中。为 true 时启用未闭合语法修复 */
  streaming?: boolean
  className?: string
}

/**
 * `memo` 是必要的而不是优化：流式期间父组件每个 delta 都重渲染，
 * 而已经定稿的历史消息内容根本没变，不该跟着重新解析 markdown。
 */
export const Response = memo(function Response({
  children,
  streaming = false,
  className,
}: ResponseProps) {
  return (
    <Streamdown
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      // 代码高亮用 shiki（streamdown 内置）。深浅两套主题
      shikiTheme={['github-light', 'github-dark']}
      /**
       * 只留复制，关掉下载和全屏。
       * 聊天里几乎没人会下载一个三行的代码片段，那几个按钮占的地方比代码还大。
       */
      controls={{
        code: { copy: true, download: false },
        table: { copy: true, download: false, fullscreen: false },
      }}
      className={cn(
        'prose prose-sm max-w-none text-foreground',
        'prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90',
        'prose-strong:text-foreground prose-blockquote:text-muted-foreground',
        // 收紧间距 —— prose 的默认值是给长文排版的，对话里太松
        'prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:mt-4 prose-headings:mb-2',

        /**
         * ⚠️ 必须中和 prose 对 code / pre 的样式，否则和 streamdown 自己的样式叠加。
         *
         * 两个具体症状：
         *   ① prose 给行内代码加了 `content: '`'` 伪元素 —— 界面上会**真的显示出反引号**
         *   ② prose 和 streamdown 各画一层代码块背景和边框 —— 变成双层框，中间一片空白
         */
        'prose-code:before:content-none prose-code:after:content-none',
        'prose-code:rounded prose-code:bg-accent prose-code:px-1 prose-code:py-0.5',
        'prose-code:font-normal prose-code:text-foreground',
        'prose-pre:m-0 prose-pre:border-0 prose-pre:bg-transparent prose-pre:p-0',
        className,
      )}
    >
      {children}
    </Streamdown>
  )
})
