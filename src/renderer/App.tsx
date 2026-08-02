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
import {
  currentMessagesAtom,
  currentSessionIdAtom,
  currentStreamAtom,
  currentMarkersAtom,
  type ToolActivity,
  messagesBySessionAtom,
  queuedPromptsAtom,
  sessionsAtom,
  workspacesAtom,
  currentWorkspaceIdAtom,
  channelsAtom,
  profilesAtom,
} from './atoms/agent.ts'
import { roleOf, type SessionMessage } from '../shared/types/message.ts'
import type { SessionMeta } from '../shared/ipc.ts'
import type { WorkspaceMountResolution } from '../shared/ipc.ts'
import { ToolCard } from './components/ToolCard.tsx'
import { ActionDock } from './features/interactions/ActionDock.tsx'
import { CompactionDivider } from './components/CompactionDivider.tsx'
import { CompactionStatus } from './components/CompactionStatus.tsx'
import { ChannelSettingsPanel } from './features/settings/ChannelSettingsPanel.tsx'
import {
  parseModelPreference,
  readSettingsPreferences,
} from './features/settings/settings-preferences.ts'
import { MARKER_STYLE, SystemMarker } from './components/SystemMarker.tsx'
import type { PermissionMode } from '../shared/types/permission.ts'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './components/ai-elements/conversation.tsx'
import { Response } from './components/ai-elements/response.tsx'
import { useTheme } from './features/theme/ThemeToggle.tsx'
import { AppShell } from './features/shell/AppShell.tsx'
import { ConversationHeader } from './features/conversation/ConversationHeader.tsx'
import { SessionSidebar } from './features/session/SessionSidebar.tsx'
import { SessionActionDialog } from './features/session/SessionActionDialog.tsx'
import { AgentComposer } from './features/composer/AgentComposer.tsx'
import {
  hasUnsavedDraft,
  type NavigationIntent,
} from './features/session/session-view.ts'

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
  const messages = useAtomValue(currentMessagesAtom)
  const stream = useAtomValue(currentStreamAtom)
  const markers = useAtomValue(currentMarkersAtom)
  const currentSession = sessions.find((x) => x.id === currentId)
  const mode: PermissionMode = currentSession?.permissionMode ?? 'auto'
  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(true)
  const [mountStatus, setMountStatus] = useState<WorkspaceMountResolution>()
  // A02：输入区附件草稿（已 stage 到 BlobStore，发送前可移除）
  const [attachmentDrafts, setAttachmentDrafts] = useState<AttachmentDraft[]>([])
  const [pendingNavigation, setPendingNavigation] = useState<NavigationIntent>()
  const [navigationBusy, setNavigationBusy] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const resultsToggleRef = useRef<HTMLButtonElement>(null)
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
    void window.tgbuddy.session.list().then(async (sessionList) => {
      setSessions(sessionList)
      const preferences = readSettingsPreferences(window.localStorage)
      const lastSessionId = window.localStorage.getItem('tgbuddy-last-session')
      if (
        !preferences.restoreOnLaunch
        || !lastSessionId
        || !sessionList.some((session) => session.id === lastSessionId)
      ) return
      setCurrentId(lastSessionId)
      const restoredMessages = await window.tgbuddy.session.messages(lastSessionId)
      setMessagesMap((current) => new Map(current).set(lastSessionId, restoredMessages))
    })
  }, [setCurrentId, setMessagesMap, setSessions])

  useEffect(() => {
    if (currentId) window.localStorage.setItem('tgbuddy-last-session', currentId)
  }, [currentId])

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

  async function newSession(selection: {
    profileId?: string
    channelId?: string
    modelId?: string
  } = {}) {
    const preferences = readSettingsPreferences(window.localStorage)
    const primaryModel = parseModelPreference(preferences.primaryModel)
    const meta = await window.tgbuddy.session.create({
      ...(primaryModel ?? {}),
      ...selection,
    })
    if (preferences.defaultPermissionMode !== 'auto') {
      await window.tgbuddy.plan.setMode(meta.id, preferences.defaultPermissionMode)
    }
    setSessions(await window.tgbuddy.session.list())
    setCurrentId(meta.id)
    return meta
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
    const nextSessions = await window.tgbuddy.session.list()
    setSessions(nextSessions)
    if (currentId && !nextSessions.some((session) => session.id === currentId)) {
      setCurrentId(null)
    }
  }

  async function executeNavigation(intent: NavigationIntent) {
    if (intent.kind === 'new-session') return newSession()
    if (intent.kind === 'switch-session') return selectSession(intent.sessionId)
    return selectWorkspace(intent.workspaceId)
  }

  async function requestNavigation(intent: NavigationIntent) {
    if (hasUnsavedDraft(input, attachmentDrafts)) {
      setPendingNavigation(intent)
      return
    }
    await executeNavigation(intent)
  }

  async function discardDraftAndContinue() {
    if (!pendingNavigation || navigationBusy) return
    const intent = pendingNavigation
    const drafts = attachmentDrafts
    setNavigationBusy(true)
    setInput('')
    setAttachmentDrafts([])
    try {
      await Promise.all(drafts.map(async (draft) => {
        try {
          await window.tgbuddy.attachment.discard(draft.ref)
        } catch (error) {
          console.error('[草稿保护] 清理未发送附件失败：', error)
        }
      }))
      await executeNavigation(intent)
      setPendingNavigation(undefined)
    } finally {
      setNavigationBusy(false)
    }
  }

  async function addWorkspace() {
    const path = await window.tgbuddy.workspace.pick()
    if (!path) return
    const created = await window.tgbuddy.workspace.create({ path })
    await selectWorkspace(created.id)
    setWorkspaces(await window.tgbuddy.workspace.list())
  }

  async function send() {
    const text = input.trim()
    if ((!text && attachmentDrafts.length === 0) || stream.running || queuedPrompt) return
    const sessionId = currentId ?? (await newSession()).id
    const attachments = attachmentDrafts.map((draft) => draft.ref)
    setInput('')
    setAttachmentDrafts([])
    if (stream.compaction) {
      setQueuedPrompts((current) => new Map(current).set(sessionId, text))
      return
    }
    await window.tgbuddy.agent.send({
      sessionId,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
    })
  }

  async function updateCurrentSessionMeta(patch: {
    profileId?: string
    channelId?: string
    modelId?: string
  }): Promise<void> {
    if (!currentId) {
      if (!patch.profileId && !patch.channelId && !patch.modelId) return
      await newSession(patch)
      return
    }
    await window.tgbuddy.session.updateMeta(currentId, patch)
    setSessions(await window.tgbuddy.session.list())
  }

  function refreshComposerCapabilities(): void {
    void Promise.all([
      window.tgbuddy.channel.list(),
      window.tgbuddy.profile.list(),
    ]).then(([channelList, profileList]) => {
      setChannels(channelList)
      setProfiles(profileList)
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

  function closeResults() {
    setResultsOpen(false)
    requestAnimationFrame(() => resultsToggleRef.current?.focus())
  }

  useEffect(() => {
    const createOnShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      void requestNavigation({ kind: 'new-session' })
    }
    window.addEventListener('keydown', createOnShortcut)
    return () => window.removeEventListener('keydown', createOnShortcut)
  }, [input, attachmentDrafts])

  return (
    <AppShell resultsOpen={resultsOpen} onCloseResults={closeResults}>
      {settingsOpen && (
        <ChannelSettingsPanel
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {pendingNavigation && (
        <SessionActionDialog
          title="保留未发送内容"
          description="当前输入或附件还没有发送。你可以留下继续编辑，或丢弃后完成刚才的导航。"
          confirmLabel="丢弃并继续"
          cancelLabel="留下"
          danger
          busy={navigationBusy}
          onCancel={() => setPendingNavigation(undefined)}
          onConfirm={() => void discardDraftAndContinue()}
        />
      )}

      {/* ── 侧边栏 ────────────────────────────────────────── */}
      <SessionSidebar
        sessions={sessions}
        currentSessionId={currentId}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        mountStatus={mountStatus}
        theme={theme}
        onToggleTheme={toggleTheme}
        onNewSession={() => requestNavigation({ kind: 'new-session' })}
        onSelectSession={(sessionId) => requestNavigation({ kind: 'switch-session', sessionId })}
        onSelectWorkspace={(workspaceId) => requestNavigation({ kind: 'switch-workspace', workspaceId })}
        onAddWorkspace={addWorkspace}
        onOpenSettings={() => setSettingsOpen(true)}
        onSessionsChanged={async () => {
          const nextSessions = await window.tgbuddy.session.list()
          setSessions(nextSessions)
          if (currentId && !nextSessions.some((session) => session.id === currentId)) {
            setCurrentId(null)
          }
        }}
      />
      {/* ── 对话区 ────────────────────────────────────────── */}
      <main className="flex min-w-[430px] flex-1 flex-col bg-content-area max-[640px]:min-w-0">
        <ConversationHeader
          title={currentSession?.title?.trim() || '新任务'}
          running={stream.running}
          resultsOpen={resultsOpen}
          onToggleResults={() => setResultsOpen((open) => !open)}
          resultsToggleRef={resultsToggleRef}
        />
        <Conversation className="flex-1">
          {!currentId ? (
            <SessionSamples onPick={startFromSample} />
          ) : (
            <ConversationContent className="mx-auto w-full max-w-[720px] gap-0.5 px-6 pb-2.5 pt-6">
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
                <pre className="mb-1 max-w-[700px] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 font-mono text-[10.8px] leading-[1.7] text-muted-foreground">
                  {stream.thinking}
                </pre>
              )}
              {stream.text && <AssistantResponse streaming>{stream.text}</AssistantResponse>}

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
                  {...(t.reason ? { reason: t.reason } : {})}
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

              {/* ★ 内核错误必须显示。不显示的话认证失败看起来就是"模型不说话" */}
              {stream.error && (
                <div className="rounded-[9px] border border-status-error/30 bg-status-error/10 px-3 py-2 text-[12.5px] text-status-error">
                  {stream.error}
                </div>
              )}

            </ConversationContent>
          )}
          <ConversationScrollButton />
        </Conversation>

        {/* ── 输入区：结构与交互以 V3 原型为准 ───────────────────── */}
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="attachment-input"
          onChange={(event) => void onPickAttachments(event.target.files)}
        />
        <ActionDock sessionId={currentId ?? undefined} />
        <AgentComposer
          sessionId={currentId ?? undefined}
          mode={mode}
          profileId={currentSession?.profileId}
          channelId={currentSession?.channelId}
          modelId={currentSession?.modelId}
          channels={channels}
          profiles={profiles}
          contextUsage={currentSession?.contextUsage}
          value={input}
          attachments={attachmentDrafts.map((draft) => draft.ref)}
          running={stream.running}
          compacting={Boolean(stream.compaction)}
          queued={Boolean(queuedPrompt)}
          onValueChange={setInput}
          onPickAttachments={() => attachmentInputRef.current?.click()}
          onRemoveAttachment={(ref) => void discardAttachment(ref)}
          onModeChange={(nextMode) => {
            if (!currentId) return
            void window.tgbuddy.plan.setMode(currentId, nextMode).then(() =>
              window.tgbuddy.session.list().then(setSessions),
            )
          }}
          onProfileChange={(profile) => {
            if (profile) {
              void updateCurrentSessionMeta({
                profileId: profile.id,
                channelId: profile.channelId,
                modelId: profile.modelId,
              })
              return
            }
            const selected = profiles.find((item) => item.id === currentSession?.profileId)
            void updateCurrentSessionMeta({
              profileId: undefined,
              channelId: selected?.channelId ?? currentSession?.channelId,
              modelId: selected?.modelId ?? currentSession?.modelId,
            })
          }}
          onModelChange={(channel, model) => void updateCurrentSessionMeta({
            profileId: undefined,
            channelId: channel.id,
            modelId: model.id,
          })}
          onRefreshCapabilities={refreshComposerCapabilities}
          onSend={() => void send()}
          onStop={() => currentId && window.tgbuddy.agent.stop(currentId)}
        />
      </main>

      {/* ── 结果区（A06：产物列表，时间倒序 + 分组 + 类型筛选）────────── */}
      <ResultsPanel
        sessionId={currentId ?? undefined}
        active={stream.running}
        open={resultsOpen}
        onClose={closeResults}
      />
    </AppShell>
  )
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
          <div className="flex w-full max-w-[560px] flex-col gap-2 rounded-[15px_15px_4px_15px] bg-primary p-3 text-primary-foreground shadow-[0_2px_8px_rgba(20,20,18,.09)]">
            <textarea
              aria-label="编辑消息"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={Math.max(2, Math.min(8, draft.split('\n').length))}
              autoFocus
              className="min-h-[64px] resize-y bg-transparent text-[13px] leading-[1.7] text-primary-foreground outline-none"
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
                className="rounded-[6px] bg-transparent px-[9px] py-1 text-[11px] text-primary-foreground/65 hover:bg-primary-foreground/10 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || submitting}
                className="rounded-[6px] bg-primary-foreground/10 px-[9px] py-1 text-[11px] text-primary-foreground/85 hover:bg-primary-foreground/15 disabled:opacity-40"
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
        <div className="mb-[13px] mt-[3px] max-w-[560px] whitespace-pre-wrap rounded-[15px_15px_4px_15px] bg-primary px-3.5 py-[11px] text-[13px] leading-[1.7] text-primary-foreground shadow-[0_2px_8px_rgba(20,20,18,.09)]">
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
              className="rounded-[6px] bg-transparent px-[9px] py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
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
              className="rounded-[6px] bg-transparent px-[9px] py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
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
            return <AssistantResponse key={i}>{block.text}</AssistantResponse>
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

function AssistantResponse({
  children,
  streaming = false,
}: {
  children: string
  streaming?: boolean
}) {
  return (
    <div className="flex max-w-[700px] gap-2.5 pb-3 pt-[7px]">
      <span className="mt-px grid h-[23px] w-[23px] shrink-0 place-items-center rounded-[7px] bg-accent text-[10px] font-bold text-foreground/65 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        T
      </span>
      <Response
        streaming={streaming}
        className="min-w-0 flex-1 text-[13px] leading-[1.8] text-foreground/75 prose-p:my-0 prose-p:text-foreground/75 prose-li:text-foreground/75"
      >
        {children}
      </Response>
    </div>
  )
}
