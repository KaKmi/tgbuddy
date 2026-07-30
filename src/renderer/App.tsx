/**
 * 阶段 2 的临时界面 —— 三栏骨架 + 能发消息看到流式。
 *
 * ⚠️ 这层 UI 是**一次性的**，等设计稿回来会整个替换。
 *    别在这里投入太多，也别把逻辑写进组件——
 *    真正该稳定下来的是 atoms 和 IPC 契约。
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import {
  currentMessagesAtom,
  currentSessionIdAtom,
  currentStreamAtom,
  currentPermissionsAtom,
  currentPlansAtom,
  currentAskUserAtom,
  currentMarkersAtom,
  type ToolActivity,
  messagesBySessionAtom,
  queuedPromptsAtom,
  sessionsAtom,
} from './atoms/agent.ts'
import { roleOf, type SessionMessage } from '../shared/types/message.ts'
import type { SessionMeta } from '../shared/ipc.ts'
import { PermissionBanner } from './components/PermissionBanner.tsx'
import { ToolCard } from './components/ToolCard.tsx'
import { PlanApproval } from './components/PlanApproval.tsx'
import { AskUserCard } from './components/AskUserCard.tsx'
import { ContextUsagePanel } from './components/ContextUsagePanel.tsx'
import { CompactionDivider } from './components/CompactionDivider.tsx'
import { CompactionStatus } from './components/CompactionStatus.tsx'
import { MARKER_STYLE, SystemMarker } from './components/SystemMarker.tsx'
import type { PermissionMode } from '../shared/types/permission.ts'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './components/ai-elements/conversation.tsx'
import { Response } from './components/ai-elements/response.tsx'

export function App() {
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [currentId, setCurrentId] = useAtom(currentSessionIdAtom)
  const setMessagesMap = useSetAtom(messagesBySessionAtom)
  const [queuedPrompts, setQueuedPrompts] = useAtom(queuedPromptsAtom)
  const messages = useAtomValue(currentMessagesAtom)
  const stream = useAtomValue(currentStreamAtom)
  const permissions = useAtomValue(currentPermissionsAtom)
  const plans = useAtomValue(currentPlansAtom)
  const questions = useAtomValue(currentAskUserAtom)
  const markers = useAtomValue(currentMarkersAtom)
  const currentSession = sessions.find((x) => x.id === currentId)
  const mode: PermissionMode = currentSession?.permissionMode ?? 'auto'
  const [input, setInput] = useState('')
  const queuedPrompt = currentId ? queuedPrompts.get(currentId) : undefined

  // 工具调用 ↔ 结果的配对索引，整段历史只建一次
  const toolResults = useMemo(() => buildToolResultMap(messages), [messages])

  // 流式期间实时卡片优先：历史里同一个工具先不画，避免重复。
  // run 结束时 toolActivities 被清空，展示权自动交回历史。
  const liveToolIds = useMemo(
    () => new Set(stream.toolActivities.map((t) => t.toolCallId)),
    [stream.toolActivities],
  )

  useEffect(() => {
    void window.tgbuddy.session.list().then(setSessions)
  }, [setSessions])

  // 会话元数据（状态、活动摘要）在主进程更新，流式状态一变就重新拉一次列表。
  // TODO: 主进程直接推 meta 变更事件，省掉这次轮询式的重取
  useEffect(() => {
    void window.tgbuddy.session.list().then(setSessions)
  }, [stream.running, stream.toolActivities.length, setSessions])

  async function newSession() {
    const meta = await window.tgbuddy.session.create({})
    setSessions(await window.tgbuddy.session.list())
    setCurrentId(meta.id)
  }

  async function selectSession(id: string) {
    setCurrentId(id)
    const msgs = await window.tgbuddy.session.messages(id)
    setMessagesMap((prev) => new Map(prev).set(id, msgs))
  }

  async function send() {
    const text = input.trim()
    if (!text || !currentId || stream.running || queuedPrompt) return
    setInput('')
    if (stream.compaction) {
      setQueuedPrompts((current) => new Map(current).set(currentId, text))
      return
    }
    await window.tgbuddy.agent.send({ sessionId: currentId, text })
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* ── 侧边栏 ────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-background">
        <div className="p-3">
          <button
            onClick={newSession}
            className="w-full rounded-lg border border-dashed border-muted-foreground/25 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
          >
            + 新会话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {groupSessions(sessions).map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">{group.title}</div>
              {group.items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left transition-colors ${
                    s.id === currentId ? 'bg-accent' : 'hover:bg-accent/60'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        s.id === currentId ? 'text-foreground' : 'text-foreground/80'
                      }`}
                    >
                      {s.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(s.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {s.status === 'running' && (
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                    )}
                    <span
                      className={`truncate text-[11px] ${
                        s.status === 'failed' ? 'text-red-400/80' : 'text-muted-foreground'
                      }`}
                    >
                      {sessionSubtitle(s)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">还没有会话</p>
          )}
        </div>
      </aside>

      {/* ── 对话区 ────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col bg-content-area">
        <Conversation className="flex-1">
          {!currentId ? (
            <ConversationEmptyState
              title="还没有选中会话"
              description="新建一个会话开始"
            />
          ) : (
            <ConversationContent className="mx-auto w-full max-w-3xl gap-4 px-6 py-6">
              {messages.map((m) => (
                <MessageView
                  key={m.id}
                  sessionId={currentId}
                  message={m}
                  toolResults={toolResults}
                  liveToolIds={liveToolIds}
                />
              ))}

              {/* 流式中的内容 */}
              {stream.thinking && (
                <pre className="whitespace-pre-wrap rounded-lg bg-card p-3 text-xs text-muted-foreground">
                  {stream.thinking}
                </pre>
              )}
              {stream.text && <Response streaming>{stream.text}</Response>}

              {currentId && stream.compaction && (
                <CompactionStatus sessionId={currentId} state={stream.compaction} />
              )}

              {stream.toolActivities.map((t) => (
                <ToolCard
                  key={t.toolCallId}
                  name={t.toolName}
                  args={t.args}
                  status={t.status}
                  {...(t.result ? { result: t.result } : {})}
                  {...(t.elapsedMs !== undefined ? { elapsedMs: t.elapsedMs } : {})}
                />
              ))}

              {/* 系统标记：重试、压缩、专家切换等时间线事件 */}
              {markers.map((m) => (
                <SystemMarker
                  key={m.id}
                  glyph={MARKER_STYLE[m.kind].glyph}
                  color={MARKER_STYLE[m.kind].color}
                  text={m.text}
                  {...(m.detail ? { detail: m.detail } : {})}
                />
              ))}

              {/* 授权请求 —— inline 卡片，不打断心流 */}
              {permissions.map((p) => (
                <PermissionBanner key={p.requestId} request={p} />
              ))}

              {/* 计划待审批 */}
              {plans.map((p) => (
                <PlanApproval key={p.requestId} request={p} />
              ))}

              {questions.map((request) => (
                <AskUserCard key={request.requestId} request={request} />
              ))}

              {/* ★ 内核错误必须显示。不显示的话认证失败看起来就是"模型不说话" */}
              {stream.error && (
                <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {stream.error}
                </div>
              )}

            </ConversationContent>
          )}
          <ConversationScrollButton />
        </Conversation>

        {/* ── 输入框 ──────────────────────────────────────── */}
        <div className="border-t p-4">
          {currentId && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-1.5">
              <ModeChip sessionId={currentId} mode={mode} />
              {currentSession?.contextUsage && (
                <ContextUsagePanel
                  sessionId={currentId}
                  usage={currentSession.contextUsage}
                  disabled={stream.running || Boolean(stream.compaction)}
                />
              )}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-card p-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={2}
              placeholder={currentId ? '说点什么…（Enter 发送，Shift+Enter 换行）' : '先新建会话'}
              disabled={!currentId}
              className="flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
            />
            {stream.running ? (
              <button
                onClick={() => currentId && window.tgbuddy.agent.stop(currentId)}
                className="shrink-0 rounded-xl bg-status-error/20 px-4 py-2 text-sm text-status-error transition-colors hover:bg-status-error/30"
              >
                停止
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!currentId || !input.trim() || Boolean(queuedPrompt)}
                className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                {stream.compaction ? '排队' : '发送'}
              </button>
            )}
          </div>
          {queuedPrompt && (
            <p className="mx-auto mt-2 max-w-3xl text-right text-[11px] text-muted-foreground">
              已排队，压缩完成后自动发送
            </p>
          )}
        </div>
      </main>

      {/* ── 结果区（阶段 4 之后才有内容）──────────────────── */}
      <aside className="hidden w-72 shrink-0 border-l bg-background xl:block">
        <div className="border-b px-4 py-3 text-sm font-medium">结果</div>
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">
          本次会话的产出会出现在这里
        </p>
      </aside>
    </div>
  )
}

/**
 * 权限模式切换 —— 对应原型输入框上方那排入口的第一个。
 *
 * 每项都带一句人话说明。这比一个写着 `auto / plan / bypass` 的下拉好懂得多，
 * 而且「完全访问」那条明确写出风险，不给人误点的机会。
 */
const MODES: { id: PermissionMode; label: string; desc: string }[] = [
  { id: 'auto', label: '默认权限', desc: '只读工具直接执行，写和命令逐次授权' },
  { id: 'plan', label: '计划模式', desc: '先出计划，你批准后才动手' },
  { id: 'bypass', label: '完全访问', desc: '不再询问。仅建议在沙箱或一次性容器里用' },
]

function ModeChip({ sessionId, mode }: { sessionId: string; mode: PermissionMode }) {
  const [open, setOpen] = useState(false)
  const current = MODES.find((m) => m.id === mode) ?? MODES[0]!

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-accent"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background:
              mode === 'plan' ? '#9dbfe0' : mode === 'bypass' ? '#c9635b' : '#7f8b98',
          }}
        />
        {current.label}
      </button>

      {open && (
        <>
          {/* 点外面关掉。用一层透明遮罩比全局监听简单，也不会漏掉 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1.5 w-72 overflow-hidden rounded-xl bg-popover shadow-lg ring-1 ring-border">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  void window.tgbuddy.plan.setMode(sessionId, m.id)
                  setOpen(false)
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-1.5 text-xs text-foreground">
                  {m.label}
                  {m.id === mode && <span className="text-muted-foreground">✓</span>}
                </span>
                <span className="text-[11px] text-muted-foreground">{m.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── 侧边栏元数据的展示逻辑 ──────────────────────────────────────
// 注意这些全部只依赖 SessionMeta，不读 JSONL —— 列 200 个会话不能读 200 个文件。

/** 侧边栏第二行：运行中显示实时活动，失败显示原因，完成显示产物数 */
function sessionSubtitle(s: SessionMeta): string {
  if (s.status === 'running') return s.lastActivity ?? '进行中…'
  if (s.status === 'interrupted') {
    return `已中断 · ${s.statusDetail ?? '可继续发送'}`
  }
  if (s.status === 'failed') return `失败 · ${s.statusDetail ?? '未知原因'}`
  if (s.artifactCount) return `已完成 · ${s.artifactCount} 个产物`
  if (s.status === 'done') return '已完成'
  return '未开始'
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diff < 7 * 86_400_000) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]!
  return `${d.getMonth() + 1}-${d.getDate()}`
}

/** 置顶 / 今天 / 更早 · 7 天内 / 更早 */
function groupSessions(sessions: SessionMeta[]): { title: string; items: SessionMeta[] }[] {
  const now = Date.now()
  const buckets: Record<string, SessionMeta[]> = { 置顶: [], 今天: [], '更早 · 7 天内': [], 更早: [] }

  for (const s of sessions) {
    if (s.archived) continue
    if (s.pinned) {
      buckets['置顶']!.push(s)
      continue
    }
    const sameDay = new Date(s.updatedAt).toDateString() === new Date(now).toDateString()
    if (sameDay) buckets['今天']!.push(s)
    else if (now - s.updatedAt < 7 * 86_400_000) buckets['更早 · 7 天内']!.push(s)
    else buckets['更早']!.push(s)
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => ({ title, items }))
}

/** toolCallId → 该次调用的结果。历史回放时用来给工具卡片定状态 */
export type ToolResultMap = Map<string, { isError: boolean; text: string }>

/**
 * 从整段历史里建一次配对索引。
 *
 * ⚠️ 必须 `useMemo` 建一张表，**不要在每个工具卡片里遍历全部消息找结果**。
 * 若在每张卡片中遍历全部消息，复杂度会变成 O(消息数 × 工具数)，
 * 流式期间引用频繁变化时长会话会明显卡顿。
 */
export function buildToolResultMap(messages: SessionMessage[]): ToolResultMap {
  const map: ToolResultMap = new Map()
  for (const m of messages) {
    if (m.kind !== 'kernel' || m.message.role !== 'toolResult') continue
    const text = m.message.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim()
    map.set(m.message.toolCallId, { isError: m.message.isError, text })
  }
  return map
}

function MessageView({
  sessionId,
  message,
  toolResults,
  liveToolIds,
}: {
  sessionId: string
  message: SessionMessage
  toolResults: ToolResultMap
  liveToolIds: Set<string>
}) {
  if (message.kind === 'notice' && message.notice === 'session_resumed') {
    return (
      <SystemMarker
        glyph={MARKER_STYLE.session_resumed.glyph}
        color={MARKER_STYLE.session_resumed.color}
        text={message.text}
      />
    )
  }

  if (roleOf(message) === 'notice') {
    return (
      <div className="py-1 text-center text-xs text-muted-foreground">
        {(message as { text: string }).text}
      </div>
    )
  }

  if (message.kind === 'compaction') {
    return <CompactionDivider sessionId={sessionId} message={message} />
  }

  if (message.kind !== 'kernel') return null
  const inner = message.message

  if (inner.role === 'user') {
    const text =
      typeof inner.content === 'string'
        ? inner.content
        : inner.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-card px-4 py-2.5 text-sm leading-relaxed">{text}</div>
      </div>
    )
  }

  if (inner.role === 'assistant') {
    // 一条 assistant 消息可能同时有正文和多个工具调用，按顺序全部渲染
    return (
      <div className="space-y-2">
        {inner.content.map((block, i) => {
          if (block.type === 'text' && block.text.trim()) {
            return <Response key={i}>{block.text}</Response>
          }
          if (block.type === 'toolCall') {
            if (liveToolIds.has(block.id)) return null // 实时卡片正在显示它
            const r = toolResults.get(block.id)
            return (
              <ToolCard
                key={block.id}
                name={block.name}
                args={block.arguments}
                // 结果缺失 = 这次调用没跑完（用户中途停了，或应用崩了）
                status={!r ? 'unknown' : r.isError ? 'error' : 'success'}
                {...(r ? { result: r } : {})}
              />
            )
          }
          return null
        })}
      </div>
    )
  }

  // toolResult 消息本身不单独渲染 —— 它的内容显示在对应的工具卡片里
  return null
}
