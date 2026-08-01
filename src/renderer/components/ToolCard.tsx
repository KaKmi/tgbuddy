/**
 * 工具卡片 —— 尺寸与配色**逐项对齐交互原型**。
 *
 * 原型里的关键数值（不是拍脑袋定的，改之前先想清楚）：
 *   - 圆角 11px，卡片最大宽 720px，卡片之间只隔 2px（紧密堆叠）
 *   - 描边用 `inset 0 0 0 1px rgba(255,255,255,.05)` 而不是 border ——
 *     inset shadow 不占布局，而且 5% 白几乎看不见，只在深底上勾出一道极淡的边
 *   - 左侧状态色条 2px；成功态是 transparent，也就是**成功不画条**
 *   - 头部 padding 9px 12px，元素间隔 9px
 *   - 工具名 chip：11.5px 等宽，2px/7px 内边距，圆角 5px，底 rgba(255,255,255,.055)
 *   - 描述 13px（比正文小一号）
 *
 * ## 成功态是灰蓝不是绿
 *
 * 原型里 `ok.color = '#7f8b98'` —— 一个去饱和的灰蓝。
 * 这是刻意的：一次任务里绝大多数调用都成功，用绿色会让整屏发绿，
 * 反而把唯一那个红叉淹掉。**颜色标记异常，不标记常态。**
 */

import { Check, ChevronRight, CircleSlash, Loader2, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/utils.ts'

export type ToolStatus =
  | 'awaiting_permission'
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'unknown'

/** 逐项取自原型的 ST 表 */
const ST = {
  awaiting_permission: {
    color: '#e0a33e',
    bar: '#e0a33e',
    ring: 'rgba(224,163,62,.22)',
    bg: 'rgba(224,163,62,.05)',
    badge: '等待授权',
    badgeBg: 'rgba(224,163,62,.14)',
  },
  running: {
    color: '#7fa7d4',
    bar: '#7fa7d4',
    ring: 'rgba(127,167,212,.20)',
    bg: 'rgba(127,167,212,.045)',
    badge: null,
    badgeBg: '',
  },
  success: {
    color: '#7f8b98', // ★ 灰蓝，不是绿 —— 成功是常态，不该抢注意力
    bar: 'transparent',
    ring: 'var(--tool-card-ring)',
    bg: 'var(--tool-card-bg)',
    badge: null,
    badgeBg: '',
  },
  error: {
    color: '#c9635b',
    bar: '#c9635b',
    ring: 'rgba(201,99,91,.22)',
    bg: 'rgba(201,99,91,.045)',
    badge: '失败',
    badgeBg: 'rgba(201,99,91,.14)',
  },
  // 原型 denied 与 unknown 同款低饱和灰 —— 拒绝是“没有发生”的结果，不抢红叉的注意力
  denied: {
    color: '#8a8a92',
    bar: '#55555c',
    ring: 'var(--tool-card-ring)',
    bg: 'var(--tool-card-bg)',
    badge: '已拒绝',
    badgeBg: 'rgba(255,255,255,.05)',
  },
  unknown: {
    color: '#8a8a92',
    bar: '#55555c',
    ring: 'var(--tool-card-ring)',
    bg: 'var(--tool-card-bg)',
    badge: '未完成',
    badgeBg: 'rgba(255,255,255,.05)',
  },
} as const satisfies Record<ToolStatus, unknown>

export interface ToolCardProps {
  name: string
  args: Record<string, unknown>
  status: ToolStatus
  result?: {
    isError: boolean
    text: string
    /** A04：超长输出完整内容 ref（BlobStore），点击「查看完整输出」读取 */
    outputRef?: { hash: string; size: number; mime?: string }
    /** D04：delegate_to_agent 结果，折叠组展示 child 摘要 */
    delegated?: boolean
  }
  elapsedMs?: number
}

export function ToolCard({ name, args, status, result, elapsedMs }: ToolCardProps) {
  // 失败默认展开 —— 用户需要立刻看到原因（docs/06 决定 2）
  const [open, setOpen] = useState(status === 'error')
  const [fullOutput, setFullOutput] = useState<string>()
  const [loadingOutput, setLoadingOutput] = useState(false)
  const s = ST[status]

  return (
    <div
      className="mb-0.5 max-w-[720px] overflow-hidden"
      style={{
        borderRadius: 11,
        background: s.bg,
        boxShadow: `inset 0 0 0 1px ${s.ring}`,
      }}
    >
      <div className="flex">
        {/* 左侧 2px 状态条。成功态是 transparent —— 常态不画条 */}
        <div className="w-0.5 flex-none" style={{ background: s.bar }} />

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex w-full cursor-pointer items-center gap-[9px] px-3 py-[9px] text-left transition-colors hover:bg-foreground/[.035]"
          >
            <span
              className="flex h-[18px] w-[18px] flex-none items-center justify-center"
              style={{ color: s.color }}
            >
              <StatusIcon status={status} />
            </span>

            <span
              className="flex-none rounded-[5px] px-[7px] py-0.5 font-mono text-[11.5px]"
              style={{ background: 'var(--tool-chip-bg)', color: 'var(--tool-chip-text)' }}
            >
              {name}
            </span>
            {result?.delegated && (
              <span
                className="flex-none rounded px-1.5 py-0.5 text-[10.5px]"
                style={{ background: 'rgba(176,162,224,.16)', color: '#b0a2e0' }}
              >
                子智能体
              </span>
            )}

            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">
              {describe(name, args)}
            </span>

            {s.badge && (
              <span
                className="flex-none rounded px-1.5 py-0.5 text-[11px]"
                style={{ background: s.badgeBg, color: s.color }}
              >
                {s.badge}
              </span>
            )}

            <span className="flex-none text-[11.5px] text-muted-foreground/70">
              {meta(elapsedMs, result)}
            </span>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 flex-none text-muted-foreground/50 transition-transform',
                open && 'rotate-90',
              )}
            />
          </button>

          {open && (
            <div className="space-y-2 px-3 pb-2.5 pl-[39px]">
              <Field label="参数">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </Field>
              {result && (
                <Field label={result.isError ? '错误' : '输出'}>
                  <pre
                    className={cn(
                      'max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed',
                      result.isError ? 'text-status-error/90' : 'text-muted-foreground',
                    )}
                  >
                    {previewToolText(result.text)}
                  </pre>
                </Field>
              )}
              {result?.outputRef && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="tool-output-open"
                    disabled={loadingOutput}
                    onClick={() => {
                      if (fullOutput) {
                        setFullOutput(undefined)
                        return
                      }
                      setLoadingOutput(true)
                      void window.tgbuddy.toolOutput
                        .read(result.outputRef!)
                        .then((text) => {
                          setFullOutput(text)
                          setLoadingOutput(false)
                        })
                        .catch((error: unknown) => {
                          console.error('[ToolCard] 读取完整输出失败：', error)
                          setLoadingOutput(false)
                        })
                    }}
                    className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-[#8ba7c4] hover:bg-white/10 disabled:opacity-40"
                  >
                    {loadingOutput ? '读取中…' : fullOutput ? '收起完整输出' : '查看完整输出'}
                  </button>
                </div>
              )}
              {fullOutput && (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted-foreground">
                  {fullOutput}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** K11 只展示八行预览；完整输出在 A04 接入 Blob 后提供打开入口。 */
export function previewToolText(text: string, maxLines = 8): string {
  if (!text) return '(无输出)'
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return `${lines.slice(0, maxLines).join('\n')}\n…（其余 ${lines.length - maxLines} 行暂不展示）`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-10 flex-none pt-px text-[11px] text-muted-foreground/60">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'success':
      return <Check size={14} strokeWidth={2.4} />
    case 'error':
      return <X size={14} strokeWidth={2.3} />
    case 'denied':
      return <CircleSlash size={14} strokeWidth={2} />
    case 'running':
      return <Loader2 size={13} className="animate-spin" />
    case 'awaiting_permission':
      return <TriangleAlert size={14} strokeWidth={2.1} />
    case 'unknown':
      return <CircleSlash size={14} strokeWidth={2} />
  }
}

/** 右侧元信息：`0.4s · 3 个结果`。不展开就知道这步花了多久、做了多少事 */
function meta(elapsedMs: number | undefined, result?: { text: string }): string {
  const parts: string[] = []
  if (elapsedMs !== undefined) {
    parts.push(elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`)
  }
  if (result?.text) {
    const lines = result.text.split('\n').length
    if (lines > 1) parts.push(`${lines} 行`)
  }
  return parts.join(' · ')
}

/**
 * 把工具调用翻译成一句人话。
 *
 * 原型里这句是人工写的，实际得从工具名 + 参数生成。
 * 加新工具时记得在这里补一条 —— 漏了会退化成原始参数，不致命但难读。
 */
function describe(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? args.path : undefined
  switch (name) {
    case 'read':
      return `读取 ${path ?? '文件'}`
    case 'write':
      return `写入 ${path ?? '文件'}`
    case 'edit':
      return `编辑 ${path ?? '文件'}`
    case 'glob':
      return `查找 ${typeof args.pattern === 'string' ? args.pattern : '文件'}`
    case 'delete': {
      const n = Array.isArray(args.paths) ? args.paths.length : 1
      return `删除 ${n} 个文件`
    }
    case 'bash':
      return typeof args.command === 'string' ? args.command : '执行命令'
    default:
      return path ?? (typeof args.command === 'string' ? args.command : name)
  }
}
