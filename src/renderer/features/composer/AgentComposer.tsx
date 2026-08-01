import {
  ArrowUp,
  Check,
  ChevronDown,
  Paperclip,
  Square,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AttachmentRef } from '../../../shared/contracts/attachment.ts'
import type { Channel, ChannelModel } from '../../../shared/contracts/channel.ts'
import type { Profile } from '../../../shared/contracts/profile.ts'
import type { ContextUsage } from '../../../shared/types/context.ts'
import type { PermissionMode } from '../../../shared/types/permission.ts'
import { AttachmentChipList } from '../../components/AttachmentChips.tsx'
import { ContextUsagePanel } from '../../components/ContextUsagePanel.tsx'
import { composerKeyShouldSend, profileSkillSummary } from './composer-state.ts'

type ComposerMenu = 'mode' | 'expert' | 'model' | null

const MODES: Array<{ id: PermissionMode; label: string; description: string }> = [
  { id: 'auto', label: '默认权限', description: '只读直接执行，写操作与命令逐次询问' },
  { id: 'plan', label: '计划模式', description: '先调查并提交计划，批准后才执行' },
  { id: 'bypass', label: '完全访问', description: '不再询问，仅建议在隔离环境中使用' },
]

export interface AgentComposerProps {
  sessionId?: string
  mode: PermissionMode
  profileId?: string
  channelId?: string
  modelId?: string
  channels: Channel[]
  profiles: Profile[]
  contextUsage?: ContextUsage
  value: string
  attachments: AttachmentRef[]
  running: boolean
  compacting: boolean
  queued: boolean
  onValueChange(value: string): void
  onPickAttachments(): void
  onRemoveAttachment(ref: AttachmentRef): void
  onModeChange(mode: PermissionMode): void
  onProfileChange(profile?: Profile): void
  onModelChange(channel: Channel, model: ChannelModel): void
  onRefreshCapabilities(): void
  onSend(): void
  onStop(): void
}

export function AgentComposer(props: AgentComposerProps) {
  const [menu, setMenu] = useState<ComposerMenu>(null)
  const currentMode = MODES.find((item) => item.id === props.mode) ?? MODES[0]!
  const currentProfile = props.profiles.find((item) => item.id === props.profileId)
  const currentModel = resolveCurrentModel(props)
  const sendDisabled = (!props.value.trim() && props.attachments.length === 0)
    || props.queued

  function toggle(next: Exclude<ComposerMenu, null>): void {
    const willOpen = menu !== next
    setMenu(willOpen ? next : null)
    if (willOpen && (next === 'expert' || next === 'model')) props.onRefreshCapabilities()
  }

  return (
    <div className="agent-composer-shell">
      <div className="agent-composer" data-screen-label="Agent 输入区">
        <div className="agent-composer-toolbar">
          <ComposerChip
            label="模式"
            value={currentMode.label}
            testId="mode-chip"
            expanded={menu === 'mode'}
            onClick={() => toggle('mode')}
          />
          <ComposerChip
            label="专家"
            value={currentProfile?.name ?? '未选择'}
            testId="expert-chip"
            expanded={menu === 'expert'}
            onClick={() => toggle('expert')}
          />
          <div className="agent-composer-toolbar-right">
            <button
              type="button"
              className="agent-composer-model-chip"
              data-testid="model-chip"
              aria-expanded={menu === 'model'}
              onClick={() => toggle('model')}
            >
              <span>{currentModel?.model.name ?? '选择模型'}</span>
              <ChevronDown size={11} />
            </button>
            {props.sessionId && props.contextUsage && (
              <ContextUsagePanel
                sessionId={props.sessionId}
                usage={props.contextUsage}
                disabled={props.running || props.compacting}
              />
            )}
          </div>
        </div>

        {props.attachments.length > 0 && (
          <AttachmentChipList
            attachments={props.attachments}
            onRemove={props.onRemoveAttachment}
          />
        )}

        <textarea
          data-testid="agent-composer-input"
          rows={2}
          value={props.value}
          placeholder="给 Agent 下达任务…"
          onChange={(event) => props.onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (!composerKeyShouldSend({
              key: event.key,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
            })) return
            event.preventDefault()
            props.onSend()
          }}
        />

        <div className="agent-composer-footer">
          <button
            type="button"
            className="agent-composer-attachment"
            aria-label="添加附件"
            data-testid="attachment-pick"
            disabled={props.running || props.compacting}
            onClick={props.onPickAttachments}
          >
            <Paperclip size={15} />
          </button>
          <span>{permissionHint(props.mode, props.compacting, props.queued)}</span>
          <div className="agent-composer-actions">
            {props.running && (
              <button type="button" className="agent-composer-stop" onClick={props.onStop}>
                <Square size={10} fill="currentColor" />
                停止
              </button>
            )}
            <button
              type="button"
              className="agent-composer-send"
              aria-label={props.compacting ? '排队发送' : '发送'}
              disabled={sendDisabled}
              onClick={props.onSend}
            >
              <ArrowUp size={16} strokeWidth={2.3} />
            </button>
          </div>
        </div>

        {menu && (
          <>
            <button
              type="button"
              aria-label="关闭选择菜单"
              className="agent-composer-menu-shield"
              onClick={() => setMenu(null)}
            />
            <div className={`agent-composer-menu is-${menu}`}>
              {menu === 'mode' && (
                <MenuSection title="权限模式" note="会话级">
                  {MODES.map((item) => (
                    <MenuRow
                      key={item.id}
                      title={item.label}
                      description={item.description}
                      selected={item.id === props.mode}
                      onClick={() => {
                        props.onModeChange(item.id)
                        setMenu(null)
                      }}
                    />
                  ))}
                </MenuSection>
              )}
              {menu === 'expert' && (
                <MenuSection title="专家" note="模型 · 指令 · 技能">
                  <MenuRow
                    title="不使用专家"
                    description="仅使用当前模型与应用级能力"
                    selected={!props.profileId}
                    onClick={() => {
                      props.onProfileChange(undefined)
                      setMenu(null)
                    }}
                  />
                  {props.profiles.map((profile) => (
                    <MenuRow
                      key={profile.id}
                      title={profile.name}
                      description={`${profile.modelId} · ${profileSkillSummary(profile)}`}
                      selected={profile.id === props.profileId}
                      testId="model-profile-option"
                      onClick={() => {
                        props.onProfileChange(profile)
                        setMenu(null)
                      }}
                    />
                  ))}
                  {props.profiles.length === 0 && (
                    <p className="agent-composer-menu-empty">在设置 → 模型中添加专家。</p>
                  )}
                </MenuSection>
              )}
              {menu === 'model' && (
                <MenuSection title="模型" note={currentProfile ? '选择模型会退出当前专家' : undefined}>
                  {props.channels.flatMap((channel) =>
                    channel.models.map((model) => (
                      <MenuRow
                        key={`${channel.id}:${model.id}`}
                        title={model.name}
                        description={channel.name}
                        selected={!props.profileId
                          && channel.id === currentModel?.channel.id
                          && model.id === currentModel.model.id}
                        testId="model-option"
                        onClick={() => {
                          props.onModelChange(channel, model)
                          setMenu(null)
                        }}
                      />
                    )),
                  )}
                  {props.channels.length === 0 && (
                    <p className="agent-composer-menu-empty">请先在设置中添加 Provider。</p>
                  )}
                </MenuSection>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ComposerChip({
  label,
  value,
  expanded,
  testId,
  onClick,
}: {
  label: string
  value: string
  expanded: boolean
  testId?: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      className="agent-composer-chip"
      data-testid={testId}
      aria-label={value}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span>{label}</span>
      <b>{value}</b>
      <ChevronDown size={11} />
    </button>
  )
}

function MenuSection({ title, note, children }: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <div>
      <header><strong>{title}</strong>{note && <span>{note}</span>}</header>
      <div>{children}</div>
    </div>
  )
}

function MenuRow({
  title,
  description,
  selected,
  testId,
  onClick,
}: {
  title: string
  description: string
  selected: boolean
  testId?: string
  onClick(): void
}) {
  return (
    <button type="button" data-testid={testId} className="agent-composer-menu-row" onClick={onClick}>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {selected && <Check size={14} />}
    </button>
  )
}

function resolveCurrentModel(props: AgentComposerProps): {
  channel: Channel
  model: ChannelModel
} | undefined {
  const profile = props.profiles.find((item) => item.id === props.profileId)
  const channelId = profile?.channelId ?? props.channelId
  const modelId = profile?.modelId ?? props.modelId
  const channel = props.channels.find((item) => item.id === channelId) ?? props.channels[0]
  if (!channel) return undefined
  const model = channel.models.find((item) => item.id === modelId) ?? channel.models[0]
  return model ? { channel, model } : undefined
}

function permissionHint(mode: PermissionMode, compacting: boolean, queued: boolean): string {
  if (queued) return '已排队，压缩完成后自动发送'
  if (compacting) return '正在压缩上下文，发送内容将排队'
  if (mode === 'plan') return '计划模式：先调查并提交计划'
  if (mode === 'bypass') return '完全访问：不会再询问授权'
  return '默认权限：写操作与命令会请求授权'
}
