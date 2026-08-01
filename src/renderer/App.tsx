/**
 * 阶段 2 的临时界面 —— 三栏骨架 + 能发消息看到流式。
 *
 * ⚠️ 这层 UI 是**一次性的**，等设计稿回来会整个替换。
 *    别在这里投入太多，也别把逻辑写进组件——
 *    真正该稳定下来的是 atoms 和 IPC 契约。
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AttachmentDraft, AttachmentRef } from '../shared/contracts/attachment.ts'
import { AttachmentChipList } from './components/AttachmentChips.tsx'
import { ResultsPanel } from './features/results/ResultsPanel.tsx'
import { SessionSamples } from './features/session/SessionSamples.tsx'
import { SessionMenu } from './features/session/SessionMenu.tsx'
import {
  injectEditIntent,
  stripEditIntent,
} from './features/results/edit-draft.ts'
import {
  currentMessagesAtom,
  currentSessionIdAtom,
  currentStreamAtom,
  currentPermissionsAtom,
  currentPlansAtom,
  currentAskUserAtom,
  currentMarkersAtom,
  modalPermissionRequestAtom,
  pendingPermissionCountAtom,
  type ToolActivity,
  messagesBySessionAtom,
  queuedPromptsAtom,
  sessionsAtom,
  workspacesAtom,
  currentWorkspaceIdAtom,
  channelsAtom,
  profilesAtom,
  resolveModelChipLabel,
} from './atoms/agent.ts'
import type { Channel } from '../shared/contracts/channel.ts'
import type { Profile } from '../shared/contracts/profile.ts'
import type { RunUsageLedger } from '../shared/contracts/run-snapshot.ts'
import { roleOf, type SessionMessage } from '../shared/types/message.ts'
import type { SessionMeta } from '../shared/ipc.ts'
import type { WorkspaceMountResolution } from '../shared/ipc.ts'
import { PermissionBanner } from './components/PermissionBanner.tsx'
import { PermissionModal } from './components/PermissionModal.tsx'
import { ToolCard } from './components/ToolCard.tsx'
import { PlanApproval } from './components/PlanApproval.tsx'
import { AskUserCard } from './components/AskUserCard.tsx'
import { ContextUsagePanel } from './components/ContextUsagePanel.tsx'
import { CompactionDivider } from './components/CompactionDivider.tsx'
import { CompactionStatus } from './components/CompactionStatus.tsx'
import { ChannelSettingsPanel } from './features/settings/ChannelSettingsPanel.tsx'
import { MARKER_STYLE, SystemMarker } from './components/SystemMarker.tsx'
import type { PermissionMode } from '../shared/types/permission.ts'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './components/ai-elements/conversation.tsx'
import { Response } from './components/ai-elements/response.tsx'
import { ThemeToggle, useTheme } from './features/theme/ThemeToggle.tsx'
import { AppShell } from './features/shell/AppShell.tsx'
import { ConversationHeader } from './features/conversation/ConversationHeader.tsx'

export function App() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [currentId, setCurrentId] = useAtom(currentSessionIdAtom)
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentWorkspaceIdAtom)
  const [channels, setChannels] = useAtom(channelsAtom)
  const [profiles, setProfiles] = useAtom(profilesAtom)
  const setMessagesMap = useSetAtom(messagesBySessionAtom)
  const [queuedPrompts, setQueuedPrompts] = useAtom(queuedPromptsAtom)
  const [runLedger, setRunLedger] = useState<RunUsageLedger>()
  const messages = useAtomValue(currentMessagesAtom)
  const stream = useAtomValue(currentStreamAtom)
  const permissions = useAtomValue(currentPermissionsAtom)
  const modalRequest = useAtomValue(modalPermissionRequestAtom)
  const pendingPermissionCount = useAtomValue(pendingPermissionCountAtom)
  // 用户手动收起模态时，请求退化为 inline 卡片继续可答，不能丢。
  const [dismissedModalId, setDismissedModalId] = useState<string | null>(null)
  const activeModal =
    modalRequest && modalRequest.requestId !== dismissedModalId
      ? modalRequest
      : undefined
  const inlinePermissions = permissions.filter(
    (request) => request.requestId !== activeModal?.requestId,
  )
  const plans = useAtomValue(currentPlansAtom)
  const questions = useAtomValue(currentAskUserAtom)
  const markers = useAtomValue(currentMarkersAtom)
  const currentSession = sessions.find((x) => x.id === currentId)
  const mode: PermissionMode = currentSession?.permissionMode ?? 'auto'
  const [input, setInput] = useState('')
  const [wsOpen, setWsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(true)
  const [sessionQuery, setSessionQuery] = useState('')
  const [mountStatus, setMountStatus] = useState<WorkspaceMountResolution>()
  // A02：输入区附件草稿（已 stage 到 BlobStore，发送前可移除）
  const [attachmentDrafts, setAttachmentDrafts] = useState<AttachmentDraft[]>([])
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  // A08：输入区已注入的「让 Agent 改这份」引用（切换会话时清理错误引用）
  const [editRef, setEditRef] = useState<{ sessionId: string; path: string }>()
  const queuedPrompt = currentId ? queuedPrompts.get(currentId) : undefined
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)

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

  // C12：会话最近一次 Run 的 token/cost 账本（Run 结束后刷新）。
  useEffect(() => {
    if (!currentId) {
      setRunLedger(undefined)
      return
    }
    void window.tgbuddy.runs.list(currentId).then((records) => {
      const settled = records.find(
        (record) => record.status !== 'running' && record.snapshot?.usage,
      )
      setRunLedger(settled?.snapshot?.usage)
    })
  }, [currentId, stream.running, setRunLedger])

  // C02/C04：渠道与 Profile 设置镜像，输入区模型 chip 和设置页共用。
  useEffect(() => {
    void Promise.all([
      window.tgbuddy.channel.list(),
      window.tgbuddy.profile.list(),
    ]).then(([channelList, profileList]) => {
      setChannels(channelList)
      setProfiles(profileList)
    })
  }, [setChannels, setProfiles])

  // 工作区 catalog 与 Runtime 选择状态（权威状态在主进程，这里只镜像）。
  useEffect(() => {
    void Promise.all([
      window.tgbuddy.workspace.list(),
      window.tgbuddy.workspace.current(),
    ]).then(([list, current]) => {
      setWorkspaces(list)
      setCurrentWorkspaceId(current?.id ?? list[0]?.id ?? null)
    })
  }, [setWorkspaces, setCurrentWorkspaceId])

  // 当前工作区磁盘可用性：不可用时选择器给出恢复提示，run 也会被阻止并显示 host error。
  useEffect(() => {
    if (!currentWorkspaceId) {
      setMountStatus(undefined)
      return
    }
    void window.tgbuddy.workspace.mountStatus(currentWorkspaceId).then(setMountStatus)
  }, [currentWorkspaceId])

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

  /** U01：空状态样例 → 新建会话并预填草稿（不自动发送） */
  async function startFromSample(prompt: string) {
    await newSession()
    setInput(prompt)
  }

  async function selectSession(id: string) {
    setCurrentId(id)
    const msgs = await window.tgbuddy.session.messages(id)
    setMessagesMap((prev) => new Map(prev).set(id, msgs))
  }

  async function selectWorkspace(id: string) {
    const workspace = await window.tgbuddy.workspace.select(id)
    setCurrentWorkspaceId(workspace.id)
    setWsOpen(false)
    const nextSessions = await window.tgbuddy.session.list()
    setSessions(nextSessions)
    if (currentId && !nextSessions.some((session) => session.id === currentId)) {
      setCurrentId(null)
    }
  }

  async function addWorkspace() {
    const path = await window.tgbuddy.workspace.pick()
    if (!path) return
    const created = await window.tgbuddy.workspace.create({ path })
    await selectWorkspace(created.id)
    setWorkspaces(await window.tgbuddy.workspace.list())
  }

  function jumpToPendingPermission() {
    const first = inlinePermissions[0]
    if (!first) return
    document
      .getElementById(`permission-card-${first.requestId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function send() {
    const text = input.trim()
    if ((!text && attachmentDrafts.length === 0) || !currentId || stream.running || queuedPrompt) return
    const attachments = attachmentDrafts.map((draft) => draft.ref)
    setInput('')
    setAttachmentDrafts([])
    if (stream.compaction) {
      setQueuedPrompts((current) => new Map(current).set(currentId, text))
      return
    }
    await window.tgbuddy.agent.send({
      sessionId: currentId,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
    })
  }

  /** A02：选择文件 → 逐文件 stage 到 BlobStore → 输入区 chips */
  async function onPickAttachments(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const ref = await window.tgbuddy.attachment.stage({
          name: file.name,
          ...(file.type ? { mime: file.type } : {}),
          bytes,
        })
        setAttachmentDrafts((current) => [...current, { ref, committed: false }])
      } catch (error) {
        console.error('[附件] stage 失败：', error)
      }
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
  }

  /** A02：移除未发送草稿 → 物理删除 blob（已发送的由历史回放，不在此删） */
  async function discardAttachment(ref: AttachmentRef) {
    setAttachmentDrafts((current) =>
      current.filter((draft) => draft.ref.id !== ref.id),
    )
    try {
      await window.tgbuddy.attachment.discard(ref)
    } catch (error) {
      console.error('[附件] discard 失败（交给 A09 引用计数清理）：', error)
    }
  }

  /** A08：把产物引用 + 意图注入输入区，不自动发送 */
  function requestArtifactEdit(artifact: { path?: string }) {
    const path = artifact.path
    if (!currentId || !path) return
    setInput((current) => injectEditIntent(current, path))
    setEditRef({ sessionId: currentId, path })
  }

  // A08：切换会话后清理不属于当前会话的注入引用，避免发错目标
  useEffect(() => {
    if (!editRef || editRef.sessionId === currentId) return
    setInput((current) => stripEditIntent(current, editRef.path))
    setEditRef(undefined)
  }, [currentId, editRef])

  async function editAndResend(messageId: string, text: string) {
    if (!currentId || stream.running || stream.compaction) return
    const sessionId = currentId
    const nextMessages = await window.tgbuddy.session.truncate(
      sessionId,
      messageId,
    )
    setMessagesMap((current) =>
      new Map(current).set(sessionId, nextMessages),
    )
    await window.tgbuddy.agent.send({ sessionId, text })
  }

  async function cloneFromMessage(messageId: string) {
    if (!currentId || stream.running) return
    const created = await window.tgbuddy.session.clonePrefix(
      currentId,
      messageId,
    )
    const [nextSessions, nextMessages] = await Promise.all([
      window.tgbuddy.session.list(),
      window.tgbuddy.session.messages(created.id),
    ])
    setMessagesMap((current) =>
      new Map(current).set(created.id, nextMessages),
    )
    setSessions(nextSessions)
    setCurrentId(created.id)
  }

  return (
    <AppShell>
      {activeModal && (
        <PermissionModal
          request={activeModal}
          onClose={() => setDismissedModalId(activeModal.requestId)}
        />
      )}
      {settingsOpen && (
        <ChannelSettingsPanel
          workspaceId={currentWorkspaceId}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 底部常驻授权队列提示：解决 inline 卡片被划过去的问题 */}
      {pendingPermissionCount > 0 && (
        <div
          className="fixed left-1/2 z-20 flex translate-x-[-50%] items-center gap-[10px] rounded-[22px] px-3 py-2 text-xs"
          style={{
            bottom: 168,
            background: '#26221a',
            boxShadow: '0 12px 30px rgba(0,0,0,.5), inset 0 0 0 1px rgba(224,163,62,.28)',
          }}
        >
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ background: '#e0a33e' }}
          />
          <span style={{ color: '#e6d3ae' }}>
            {pendingPermissionCount} 个授权请求等待处理
          </span>
          <button
            type="button"
            onClick={jumpToPendingPermission}
            className="rounded-[6px] px-[9px] py-[3px] text-[11.5px]"
            style={{ background: 'rgba(255,255,255,.1)', color: '#f0e6d2' }}
          >
            跳到该处
          </button>
        </div>
      )}

      {/* ── 侧边栏 ────────────────────────────────────────── */}
      <aside
        data-testid="app-sidebar"
        className="flex w-[252px] shrink-0 flex-col border-r bg-background"
      >
        <div className="border-b p-3">
          <div className="relative">
            <button
              type="button"
              data-testid="workspace-picker"
              onClick={() => setWsOpen((open) => !open)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                className="shrink-0 text-sky-400/70"
              >
                <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {currentWorkspace?.name ?? '选择工作区'}
                </span>
                <span
                  className={`block truncate font-mono text-[10.5px] ${
                    mountStatus?.ok === false
                      ? 'text-red-400/80'
                      : 'text-muted-foreground'
                  }`}
                >
                  {mountStatus?.ok === false
                    ? '目录不可用 · 请重新选择文件夹'
                    : currentWorkspace?.mount?.path ?? '还没有工作区'}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">▾</span>
            </button>
            {wsOpen && (
              <div className="absolute left-0 right-0 top-full z-40 mt-1.5 rounded-xl border border-white/5 bg-popover p-1.5 shadow-2xl">
                <div className="px-2 py-1 text-[11px] tracking-wide text-muted-foreground">
                  工作区
                </div>
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    data-testid="workspace-option"
                    onClick={() => selectWorkspace(workspace.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="w-3 shrink-0 text-center text-xs text-sky-400">
                      {workspace.id === currentWorkspaceId ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-foreground">
                        {workspace.name}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                        {workspace.mount?.path}
                      </span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="workspace-add"
                  onClick={addWorkspace}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/5 px-2 pb-1 pt-2 text-left text-xs text-sky-300 transition-colors hover:bg-accent/60"
                >
                  + 选择其他文件夹…
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="p-3">
          <button
            onClick={newSession}
            className="w-full rounded-lg border border-dashed border-muted-foreground/25 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
          >
            + 新会话
          </button>
          {/* U02：会话搜索（只过滤当前工作区） */}
          <input
            value={sessionQuery}
            onChange={(event) => setSessionQuery(event.target.value)}
            placeholder="搜索会话…"
            data-testid="session-search"
            className="mt-2 w-full rounded-lg bg-white/[.03] px-2.5 py-1.5 text-xs text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/50 focus:ring-ring/40"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {groupSessions(
            sessionQuery.trim()
              ? sessions.filter((s) =>
                  (s.title ?? '').toLowerCase().includes(sessionQuery.trim().toLowerCase()),
                )
              : sessions,
          ).map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">{group.title}</div>
              {group.items.map((s) => (
                <div key={s.id} className="group relative mb-0.5 flex items-center">
                  <button
                    data-testid="session-item"
                    onClick={() => selectSession(s.id)}
                    className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
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
                  <SessionMenu
                    session={s}
                    onChanged={async () => {
                      setSessions(await window.tgbuddy.session.list())
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">还没有会话</p>
          )}
        </div>

        <div className="flex items-center gap-1 border-t px-2 py-2">
          <button
            type="button"
            data-testid="settings-open"
            onClick={() => setSettingsOpen(true)}
            className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            ⚙ 设置
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </aside>

      {/* ── 对话区 ────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col bg-content-area">
        <ConversationHeader
          title={currentSession?.title?.trim() || '新任务'}
          running={stream.running}
          resultsOpen={resultsOpen}
          onToggleResults={() => setResultsOpen((open) => !open)}
        />
        <Conversation className="flex-1">
          {!currentId ? (
            <SessionSamples onPick={startFromSample} />
          ) : (
            <ConversationContent className="mx-auto w-full max-w-3xl gap-4 px-6 py-6">
              {messages.map((m) => (
                <MessageView
                  key={m.id}
                  sessionId={currentId}
                  message={m}
                  toolResults={toolResults}
                  liveToolIds={liveToolIds}
                  canEdit={!stream.running && !stream.compaction}
                  onEditAndResend={editAndResend}
                  onClonePrefix={cloneFromMessage}
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
              {inlinePermissions.map((p) => (
                <div key={p.requestId} id={`permission-card-${p.requestId}`}>
                  <PermissionBanner request={p} />
                </div>
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
              <ModelChip
                sessionId={currentId}
                meta={currentSession}
                channels={channels}
                profiles={profiles}
              />
              {currentSession?.contextUsage && (
                <ContextUsagePanel
                  sessionId={currentId}
                  usage={currentSession.contextUsage}
                  ledger={runLedger}
                  disabled={stream.running || Boolean(stream.compaction)}
                />
              )}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-card p-1.5">
            <div className="flex flex-1 flex-col gap-1.5">
              {attachmentDrafts.length > 0 && (
                <AttachmentChipList
                  attachments={attachmentDrafts.map((draft) => draft.ref)}
                  onRemove={(ref) => void discardAttachment(ref)}
                />
              )}
              <div className="flex items-end gap-1">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="attachment-input"
                  onChange={(event) => void onPickAttachments(event.target.files)}
                />
                <button
                  type="button"
                  aria-label="添加附件"
                  data-testid="attachment-pick"
                  disabled={!currentId || stream.running || Boolean(stream.compaction)}
                  onClick={() => attachmentInputRef.current?.click()}
                  className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                >
                  📎
                </button>
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
              </div>
            </div>
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
                disabled={
                  !currentId
                  || (!input.trim() && attachmentDrafts.length === 0)
                  || Boolean(queuedPrompt)
                }
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

      {/* ── 结果区（A06：产物列表，时间倒序 + 分组 + 类型筛选）────────── */}
      <ResultsPanel
        sessionId={currentId ?? undefined}
        onEditRequest={requestArtifactEdit}
        active={stream.running}
        open={resultsOpen}
        onClose={() => setResultsOpen(false)}
      />
    </AppShell>
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

/**
 * 输入区「模型」chip（原型入口 chips 之一）：展示当前 Profile/模型，
 * 点击选择 Profile 或渠道模型，选择即写入 Session 元数据，
 * 下一 Run 使用该不可变快照。
 */
function ModelChip({
  sessionId,
  meta,
  channels,
  profiles,
}: {
  sessionId: string
  meta: Pick<SessionMeta, 'profileId' | 'channelId' | 'modelId'> | undefined
  channels: Channel[]
  profiles: Profile[]
}) {
  const [open, setOpen] = useState(false)
  const setProfiles = useSetAtom(profilesAtom)
  const setChannels = useSetAtom(channelsAtom)
  const label = resolveModelChipLabel(meta, channels, profiles)

  // 打开菜单时刷新渠道/Profile：设置页新增/编辑后输入区即时可见，
  // 否则 profilesAtom 只在 App 挂载时加载一次，新 Profile 要重启才出现。
  function openMenu() {
    setOpen(true)
    void Promise.all([
      window.tgbuddy.channel.list(),
      window.tgbuddy.profile.list(),
    ]).then(([channelList, profileList]) => {
      setChannels(channelList)
      setProfiles(profileList)
    })
  }

  function select(selection: {
    profileId?: string
    channelId: string
    modelId: string
  }) {
    void window.tgbuddy.session.updateMeta(sessionId, selection)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        data-testid="model-chip"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-accent"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400/70" />
        <span className="max-w-36 truncate">{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-20 mb-1.5 max-h-72 w-80 overflow-y-auto rounded-xl bg-popover shadow-lg ring-1 ring-border">
            {profiles.length > 0 && (
              <>
                <div className="px-3 pb-1 pt-2 text-[10.5px] tracking-wide text-muted-foreground">
                  Profile / 专家
                </div>
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    data-testid="model-profile-option"
                    onClick={() =>
                      select({
                        profileId: profile.id,
                        channelId: profile.channelId,
                        modelId: profile.modelId,
                      })
                    }
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="text-xs text-foreground">{profile.name}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                      {profile.modelId}
                    </span>
                    {meta?.profileId === profile.id && (
                      <span className="text-muted-foreground">✓</span>
                    )}
                  </button>
                ))}
              </>
            )}
            <div className="px-3 pb-1 pt-2 text-[10.5px] tracking-wide text-muted-foreground">
              模型
            </div>
            {channels.flatMap((channel) =>
              channel.models.map((model) => (
                <button
                  key={`${channel.id}:${model.id}`}
                  data-testid="model-option"
                  onClick={() =>
                    select({
                      profileId: undefined,
                      channelId: channel.id,
                      modelId: model.id,
                    })
                  }
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {model.name}
                  </span>
                  <span className="flex-none font-mono text-[10.5px] text-muted-foreground">
                    {channel.name}
                  </span>
                  {!meta?.profileId
                    && meta?.channelId === channel.id
                    && meta?.modelId === model.id && (
                      <span className="text-muted-foreground">✓</span>
                    )}
                </button>
              )),
            )}
            {channels.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">
                还没有渠道，请先在设置中添加
              </p>
            )}
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
export type ToolResultMap = Map<
  string,
  {
    isError: boolean
    text: string
    outputRef?: { hash: string; size: number; mime?: string }
    /** D04：delegate_to_agent 的 child 摘要，UI 收进「子智能体」折叠组 */
    delegated?: boolean
  }
>

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
    const details =
      typeof m.message.details === 'object' && m.message.details !== null
        ? (m.message.details as Record<string, unknown>)
        : undefined
    const outputRef = details?.outputRef
    const delegated = details?.delegated === true
    map.set(m.message.toolCallId, {
      isError: m.message.isError,
      text,
      ...(isBlobRef(outputRef) ? { outputRef } : {}),
      ...(delegated ? { delegated: true } : {}),
    })
  }
  return map
}

function isBlobRef(value: unknown): value is { hash: string; size: number; mime?: string } {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { hash?: unknown }).hash === 'string'
    && typeof (value as { size?: unknown }).size === 'number'
  )
}

function MessageView({
  sessionId,
  message,
  toolResults,
  liveToolIds,
  canEdit,
  onEditAndResend,
  onClonePrefix,
}: {
  sessionId: string
  message: SessionMessage
  toolResults: ToolResultMap
  liveToolIds: Set<string>
  canEdit: boolean
  onEditAndResend(messageId: string, text: string): Promise<void>
  onClonePrefix(messageId: string): Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editError, setEditError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [cloning, setCloning] = useState(false)

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
    // A03 的文本附件块由 chips 展示，气泡里剥掉避免重复显示
    const displayText =
      text.replace(/\[附件 [^\]]+\][\s\S]*?\[\/附件\]/g, '').trim() || text
    if (editing) {
      const submit = async (): Promise<void> => {
        const next = draft.trim()
        if (!next || submitting) return
        setSubmitting(true)
        setEditError(undefined)
        try {
          await onEditAndResend(message.id, next)
          setEditing(false)
        } catch (error) {
          setEditError(error instanceof Error ? error.message : String(error))
        } finally {
          setSubmitting(false)
        }
      }

      return (
        <div className="flex justify-end">
          <div className="flex w-full max-w-[80%] flex-col gap-2 rounded-2xl bg-card p-3">
            <textarea
              aria-label="编辑消息"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={Math.max(2, Math.min(8, draft.split('\n').length))}
              autoFocus
              className="min-h-[64px] resize-y bg-transparent text-sm leading-relaxed text-foreground outline-none"
            />
            {editError && (
              <div className="text-[11px] text-[#dfa39d]">{editError}</div>
            )}
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setEditError(undefined)
                }}
                disabled={submitting}
                className="rounded-[6px] bg-transparent px-[9px] py-1 text-[11px] text-[#9a9aa2] hover:bg-white/[.06] disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || submitting}
                className="rounded-[6px] bg-white/[.06] px-[9px] py-1 text-[11px] text-[#b6b6be] hover:bg-white/[.12] disabled:opacity-40"
              >
                {submitting ? '重发中…' : '重发'}
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="group flex flex-col items-end gap-1">
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentChipList attachments={message.attachments} />
        )}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-card px-4 py-2.5 text-sm leading-relaxed">
          {displayText}
        </div>
        {canEdit && (
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => {
                setDraft(text)
                setEditError(undefined)
                setEditing(true)
              }}
              disabled={cloning}
              className="rounded-[6px] bg-transparent px-[9px] py-1 text-[11px] text-[#777780] hover:bg-white/[.06] hover:text-[#b6b6be] disabled:opacity-40"
            >
              编辑并重发
            </button>
            <button
              type="button"
              onClick={() => {
                setCloning(true)
                setEditError(undefined)
                void onClonePrefix(message.id).catch((error: unknown) => {
                  setEditError(error instanceof Error ? error.message : String(error))
                  setCloning(false)
                })
              }}
              disabled={cloning}
              className="rounded-[6px] bg-transparent px-[9px] py-1 text-[11px] text-[#777780] hover:bg-white/[.06] hover:text-[#b6b6be] disabled:opacity-40"
            >
              {cloning ? '创建中…' : '从此新建会话'}
            </button>
          </div>
        )}
        {editError && (
          <div className="text-[11px] text-[#dfa39d]">{editError}</div>
        )}
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
