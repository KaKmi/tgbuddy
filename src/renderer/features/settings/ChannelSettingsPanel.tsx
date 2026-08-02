import {
  Check,
  ChevronLeft,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type {
  Channel,
  ChannelModel,
  ChannelProtocol,
  ChannelSaveInput,
  ChannelTestResult,
} from '../../../shared/contracts/channel.ts'
import type {
  McpSaveInput,
  McpServerConfig,
  McpServerStatus,
} from '../../../shared/contracts/mcp.ts'
import type { PermissionMode, PermissionRule } from '../../../shared/contracts/permission.ts'
import type { Profile, ProfileSaveInput } from '../../../shared/contracts/profile.ts'
import type { SkillGroupView } from '../../../shared/contracts/skill.ts'
import type { ToolSettingView } from '../../../shared/contracts/tool.ts'
import type { ThemeName } from '../theme/theme-state.ts'
import { ProviderBrandIcon } from './ProviderBrandIcon.tsx'
import {
  readSettingsPreferences,
  writeSettingsPreferences,
  type SettingsPreferences,
} from './settings-preferences.ts'

export interface ChannelSettingsPanelProps {
  theme: ThemeName
  onToggleTheme(): void
  onClose(): void
}

type SettingsTab = 'general' | 'models' | 'permissions' | 'capabilities' | 'appearance'
type CapabilityManager = 'skills' | 'mcp' | null

interface ChannelFormState {
  id?: string
  name: string
  protocol: ChannelProtocol
  baseUrl: string
  apiKey: string
  models: ChannelModel[]
}

interface ProfileFormState {
  id?: string
  name: string
  channelId: string
  modelId: string
  systemPrompt: string
  skillIds?: string[]
}

interface McpFormState {
  id?: string
  name: string
  key: string
  transport: 'stdio' | 'http'
  command: string
  args: string
  url: string
  env: string
  enabled: boolean
}

const EMPTY_CHANNEL_FORM: ChannelFormState = {
  name: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  models: [],
}

const EMPTY_PROFILE_FORM: ProfileFormState = {
  name: '',
  channelId: '',
  modelId: '',
  systemPrompt: '',
}

const EMPTY_MCP_FORM: McpFormState = {
  name: '',
  key: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  enabled: true,
}

const TAB_META: Array<{
  id: SettingsTab
  label: string
  title: string
  subtitle: string
}> = [
  { id: 'general', label: '通用', title: '通用', subtitle: '应用行为与本地数据。' },
  { id: 'models', label: '模型', title: '模型', subtitle: 'Provider、密钥和模型分工。' },
  {
    id: 'permissions',
    label: '工具与权限',
    title: '工具与权限',
    subtitle: '权限模式、已记住的授权与工具默认行为。',
  },
  {
    id: 'capabilities',
    label: '能力',
    title: '应用能力',
    subtitle: '全局管理 Skill 与 MCP，不随工作区切换。',
  },
  { id: 'appearance', label: '外观', title: '外观', subtitle: '主题与显示偏好。' },
]

const MODE_OPTIONS: Array<{ id: PermissionMode; label: string; description: string }> = [
  { id: 'auto', label: '默认权限', description: '只读直接执行，写操作和命令逐次询问' },
  { id: 'plan', label: '计划模式', description: '先调查并提交计划，批准后才执行' },
  { id: 'bypass', label: '完全访问', description: '不再询问，仅建议在隔离环境中使用' },
]

export function ChannelSettingsPanel({
  theme,
  onToggleTheme,
  onClose,
}: ChannelSettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [manager, setManager] = useState<CapabilityManager>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tools, setTools] = useState<ToolSettingView[]>([])
  const [skillGroups, setSkillGroups] = useState<SkillGroupView[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpServerStatus>>({})
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [channelForm, setChannelForm] = useState<ChannelFormState>(EMPTY_CHANNEL_FORM)
  const [profileForm, setProfileForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM)
  const [mcpForm, setMcpForm] = useState<McpFormState>(EMPTY_MCP_FORM)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editingMcpId, setEditingMcpId] = useState<string | null>(null)
  const [confirmingRuleId, setConfirmingRuleId] = useState<string | null>(null)
  const [testStates, setTestStates] = useState<
    Record<string, { running: boolean; result?: ChannelTestResult }>
  >({})
  const [preferences, setPreferences] = useState<SettingsPreferences>(() =>
    readSettingsPreferences(window.localStorage),
  )
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const [channelList, profileList, toolList, skills, mcpList, statuses, ruleList] =
      await Promise.all([
        window.tgbuddy.channel.list(),
        window.tgbuddy.profile.list(),
        window.tgbuddy.tool.list(),
        // Skill 与 MCP 是应用级能力；设置页不再传 workspaceId。
        window.tgbuddy.skill.list(),
        window.tgbuddy.mcp.list(),
        window.tgbuddy.mcp.status(),
        window.tgbuddy.permission.rules(),
      ])
    setChannels(channelList)
    setProfiles(profileList)
    setTools(toolList.filter((tool) => tool.category === 'mcp'))
    setSkillGroups(skills)
    setMcpServers(mcpList)
    setMcpStatuses(Object.fromEntries(statuses.map((status) => [status.serverId, status])))
    setRules(ruleList)
  }

  useEffect(() => {
    void refresh().catch((refreshError: unknown) => {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    })
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (editingChannelId !== null) setEditingChannelId(null)
      else if (editingProfileId !== null) setEditingProfileId(null)
      else if (editingMcpId !== null) setEditingMcpId(null)
      else if (manager) setManager(null)
      else onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [editingChannelId, editingMcpId, editingProfileId, manager, onClose])

  function updatePreferences(patch: Partial<SettingsPreferences>): void {
    const next = { ...preferences, ...patch }
    setPreferences(next)
    writeSettingsPreferences(window.localStorage, next)
  }

  function selectTab(nextTab: SettingsTab): void {
    setTab(nextTab)
    setManager(null)
    setEditingChannelId(null)
    setEditingProfileId(null)
    setEditingMcpId(null)
    setError(undefined)
  }

  function startEditChannel(channel?: Channel): void {
    setEditingChannelId(channel?.id ?? '')
    setChannelForm(
      channel
        ? {
            id: channel.id,
            name: channel.name,
            protocol: channel.protocol,
            baseUrl: channel.baseUrl,
            apiKey: '',
            models: channel.models,
          }
        : EMPTY_CHANNEL_FORM,
    )
    setError(undefined)
  }

  async function saveChannel(): Promise<void> {
    const name = channelForm.name.trim()
    const baseUrl = channelForm.baseUrl.trim()
    if (!name || !baseUrl) {
      setError('Provider 名称和 Base URL 不能为空')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const input: ChannelSaveInput = {
        ...(channelForm.id ? { id: channelForm.id } : {}),
        name,
        protocol: channelForm.protocol,
        baseUrl,
        apiKey: channelForm.apiKey.trim() || undefined,
        models: channelForm.models,
      }
      await window.tgbuddy.channel.save(input)
      setEditingChannelId(null)
      setChannelForm(EMPTY_CHANNEL_FORM)
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function removeChannel(channelId: string): Promise<void> {
    if (!window.confirm('删除该 Provider 后，使用它的会话将无法继续运行。确认删除？')) return
    setBusy(true)
    try {
      await window.tgbuddy.channel.delete(channelId)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function testChannel(channelId: string): Promise<void> {
    setTestStates((current) => ({ ...current, [channelId]: { running: true } }))
    try {
      const result = await window.tgbuddy.channel.test(channelId)
      setTestStates((current) => ({
        ...current,
        [channelId]: { running: false, result },
      }))
      await refresh()
      const updated = await window.tgbuddy.channel.list()
      const channel = updated.find((item) => item.id === channelId)
      if (channel && editingChannelId === channelId) {
        setChannelForm((current) => ({ ...current, models: channel.models }))
      }
    } catch (testError) {
      setTestStates((current) => ({
        ...current,
        [channelId]: {
          running: false,
          result: {
            ok: false,
            code: 'unknown',
            message: testError instanceof Error ? testError.message : String(testError),
          },
        },
      }))
    }
  }

  function startEditProfile(profile?: Profile): void {
    setEditingProfileId(profile?.id ?? '')
    setProfileForm(
      profile
        ? {
            id: profile.id,
            name: profile.name,
            channelId: profile.channelId,
            modelId: profile.modelId,
            systemPrompt: profile.systemPrompt ?? '',
            ...(profile.skillIds ? { skillIds: [...profile.skillIds] } : {}),
          }
        : EMPTY_PROFILE_FORM,
    )
    setError(undefined)
  }

  async function saveProfile(): Promise<void> {
    const name = profileForm.name.trim()
    if (!name || !profileForm.channelId || !profileForm.modelId) {
      setError('专家名称、Provider 和模型不能为空')
      return
    }
    setBusy(true)
    try {
      const input: ProfileSaveInput = {
        ...(profileForm.id ? { id: profileForm.id } : {}),
        name,
        channelId: profileForm.channelId,
        modelId: profileForm.modelId,
        ...(profileForm.systemPrompt.trim()
          ? { systemPrompt: profileForm.systemPrompt.trim() }
          : {}),
        ...(profileForm.skillIds !== undefined
          ? { skillIds: [...profileForm.skillIds] }
          : {}),
      }
      await window.tgbuddy.profile.save(input)
      setEditingProfileId(null)
      setProfileForm(EMPTY_PROFILE_FORM)
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function removeProfile(profileId: string): Promise<void> {
    if (!window.confirm('删除该专家预设？已选中它的会话会回退到直接模型选择。')) return
    setBusy(true)
    try {
      await window.tgbuddy.profile.delete(profileId)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  function startEditMcp(server?: McpServerConfig): void {
    setEditingMcpId(server?.id ?? '')
    setMcpForm(
      server
        ? {
            id: server.id,
            name: server.name,
            key: server.key,
            transport: server.transport,
            command: server.command ?? '',
            args: (server.args ?? []).join(' '),
            url: server.url ?? '',
            env: Object.entries(server.env ?? {})
              .map(([key, value]) => `${key}=${value}`)
              .join('\n'),
            enabled: server.enabled,
          }
        : EMPTY_MCP_FORM,
    )
    setError(undefined)
  }

  async function saveMcp(): Promise<void> {
    const name = mcpForm.name.trim()
    if (!name) {
      setError('MCP 服务名称不能为空')
      return
    }
    const env: Record<string, string> = {}
    for (const line of mcpForm.env.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator < 1) continue
      env[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
    }
    const input: McpSaveInput = {
      ...(mcpForm.id ? { id: mcpForm.id } : {}),
      name,
      key: mcpForm.key.trim() || undefined,
      transport: mcpForm.transport,
      enabled: mcpForm.enabled,
      ...(mcpForm.transport === 'stdio'
        ? {
            command: mcpForm.command.trim(),
            args: mcpForm.args.trim() ? mcpForm.args.trim().split(/\s+/) : undefined,
          }
        : { url: mcpForm.url.trim() }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    }
    setBusy(true)
    try {
      await window.tgbuddy.mcp.save(input)
      setEditingMcpId(null)
      setMcpForm(EMPTY_MCP_FORM)
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function removeMcp(serverId: string): Promise<void> {
    if (!window.confirm('删除该 MCP 服务并断开连接？')) return
    setBusy(true)
    try {
      await window.tgbuddy.mcp.delete(serverId)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function connectMcp(serverId: string): Promise<void> {
    try {
      const status = await window.tgbuddy.mcp.connect(serverId)
      setMcpStatuses((current) => ({ ...current, [serverId]: status }))
      await refresh()
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError))
    }
  }

  async function disconnectMcp(serverId: string): Promise<void> {
    try {
      await window.tgbuddy.mcp.disconnect(serverId)
      setMcpStatuses((current) => ({
        ...current,
        [serverId]: { serverId, state: 'off' },
      }))
      await refresh()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError))
    }
  }

  async function revokeRule(ruleId: string): Promise<void> {
    await window.tgbuddy.permission.removeRule(ruleId)
    setRules(await window.tgbuddy.permission.rules())
    setConfirmingRuleId(null)
  }

  const activeMeta = TAB_META.find((item) => item.id === tab) ?? TAB_META[0]!
  const capabilityIssueCount = Object.values(mcpStatuses).filter(
    (status) => status.state === 'error',
  ).length

  return (
    <div
      data-testid="channel-settings-panel"
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <aside className="settings-sidebar">
          <div className="settings-title">设置</div>
          {TAB_META.map((item) => (
            <button
              type="button"
              key={item.id}
              data-testid={`settings-tab-${item.id}`}
              aria-current={tab === item.id ? 'page' : undefined}
              className={tab === item.id ? 'active' : ''}
              onClick={() => selectTab(item.id)}
            >
              {item.label}
              {item.id === 'capabilities' && capabilityIssueCount > 0 && (
                <span>{capabilityIssueCount}</span>
              )}
            </button>
          ))}
        </aside>

        <main className="settings-main">
          <header className="settings-head">
            <div>
              <strong>{activeMeta.title}</strong>
              <p>{activeMeta.subtitle}</p>
            </div>
            <button
              type="button"
              data-testid="channel-settings-close"
              className="settings-icon-button"
              aria-label="关闭设置"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>

          {error && (
            <div data-testid="settings-error" className="settings-error">
              {error}
            </div>
          )}

          {tab === 'general' && (
            <GeneralSettings
              preferences={preferences}
              onPreferences={updatePreferences}
            />
          )}
          {tab === 'models' && editingChannelId === null && editingProfileId === null && (
            <ModelSettings
              channels={channels}
              profiles={profiles}
              preferences={preferences}
              testStates={testStates}
              onPreferences={updatePreferences}
              onEditChannel={startEditChannel}
              onRemoveChannel={(id) => void removeChannel(id)}
              onTestChannel={(id) => void testChannel(id)}
              onEditProfile={startEditProfile}
              onRemoveProfile={(id) => void removeProfile(id)}
            />
          )}
          {tab === 'models' && editingChannelId !== null && (
            <ProviderEditor
              form={channelForm}
              channels={channels}
              busy={busy}
              testState={channelForm.id ? testStates[channelForm.id] : undefined}
              onForm={setChannelForm}
              onBack={() => {
                setEditingChannelId(null)
                setError(undefined)
              }}
              onSave={() => void saveChannel()}
              onTest={
                channelForm.id ? () => void testChannel(channelForm.id as string) : undefined
              }
            />
          )}
          {tab === 'models' && editingProfileId !== null && (
            <ProfileEditor
              form={profileForm}
              channels={channels}
              skillGroups={skillGroups}
              busy={busy}
              onForm={setProfileForm}
              onBack={() => {
                setEditingProfileId(null)
                setError(undefined)
              }}
              onSave={() => void saveProfile()}
            />
          )}
          {tab === 'permissions' && (
            <PermissionSettings
              preferences={preferences}
              rules={rules}
              confirmingRuleId={confirmingRuleId}
              onPreferences={updatePreferences}
              onConfirmRule={setConfirmingRuleId}
              onRevokeRule={(id) => void revokeRule(id)}
            />
          )}
          {tab === 'capabilities' && manager === null && (
            <CapabilitySettings
              skillGroups={skillGroups}
              mcpServers={mcpServers}
              statuses={mcpStatuses}
              onManage={setManager}
            />
          )}
          {tab === 'capabilities' && manager === 'skills' && (
            <SkillManager
              skillGroups={skillGroups}
              onBack={() => setManager(null)}
              onToggle={(skillId, enabled) =>
                void window.tgbuddy.skill
                  .setEnabled(skillId, enabled)
                  .then(() => refresh())
              }
            />
          )}
          {tab === 'capabilities' && manager === 'mcp' && editingMcpId === null && (
            <McpManager
              servers={mcpServers}
              statuses={mcpStatuses}
              tools={tools}
              onBack={() => setManager(null)}
              onAdd={() => startEditMcp()}
              onEdit={startEditMcp}
              onRemove={(id) => void removeMcp(id)}
              onConnect={(id) => void connectMcp(id)}
              onDisconnect={(id) => void disconnectMcp(id)}
            />
          )}
          {tab === 'capabilities' && manager === 'mcp' && editingMcpId !== null && (
            <McpEditor
              form={mcpForm}
              busy={busy}
              onForm={setMcpForm}
              onBack={() => {
                setEditingMcpId(null)
                setError(undefined)
              }}
              onSave={() => void saveMcp()}
            />
          )}
          {tab === 'appearance' && (
            <AppearanceSettings theme={theme} onToggleTheme={onToggleTheme} />
          )}
        </main>
      </div>
    </div>
  )
}

function GeneralSettings({
  preferences,
  onPreferences,
}: {
  preferences: SettingsPreferences
  onPreferences(patch: Partial<SettingsPreferences>): void
}) {
  function exportDiagnostics(): void {
    const content = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        language: navigator.language,
        theme: document.documentElement.dataset.theme ?? 'light',
      },
      null,
      2,
    )
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `tgbuddy-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <SettingsContent>
      <SettingsSection title="启动与会话">
        <SettingsRow title="启动时恢复" description="回到上次工作区和会话">
          <Switch
            checked={preferences.restoreOnLaunch}
            label="启动时恢复"
            onChange={(checked) => onPreferences({ restoreOnLaunch: checked })}
          />
        </SettingsRow>
        <SettingsRow title="新会话默认模式" description="仅影响新建会话">
          <select
            value={preferences.defaultPermissionMode}
            onChange={(event) =>
              onPreferences({
                defaultPermissionMode: event.target.value as PermissionMode,
              })
            }
          >
            {MODE_OPTIONS.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}</option>
            ))}
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="本地数据">
        <SettingsRow title="数据目录" description="Session、Blob 与索引均保存在本机">
          <span className="settings-quiet-badge">本机自动管理</span>
        </SettingsRow>
        <SettingsRow title="诊断信息" description="不包含 API Key 与附件正文">
          <button type="button" className="settings-secondary-button" onClick={exportDiagnostics}>
            导出
          </button>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  )
}

function ModelSettings({
  channels,
  profiles,
  preferences,
  testStates,
  onPreferences,
  onEditChannel,
  onRemoveChannel,
  onTestChannel,
  onEditProfile,
  onRemoveProfile,
}: {
  channels: Channel[]
  profiles: Profile[]
  preferences: SettingsPreferences
  testStates: Record<string, { running: boolean; result?: ChannelTestResult }>
  onPreferences(patch: Partial<SettingsPreferences>): void
  onEditChannel(channel?: Channel): void
  onRemoveChannel(channelId: string): void
  onTestChannel(channelId: string): void
  onEditProfile(profile?: Profile): void
  onRemoveProfile(profileId: string): void
}) {
  const modelOptions = channels.flatMap((channel) =>
    channel.models.map((model) => ({
      value: `${channel.id}:${model.id}`,
      label: `${model.name} · ${channel.name}`,
    })),
  )

  return (
    <SettingsContent>
      <SettingsSection title="模型分工" note="一个默认选择，必要时再覆盖">
        <SettingsRow title="主 Agent" description="新会话、工具调用与最终回答">
          <ModelSelect
            value={preferences.primaryModel}
            options={modelOptions}
            emptyLabel="跟随会话选择"
            onChange={(primaryModel) => onPreferences({ primaryModel })}
          />
        </SettingsRow>
        <SettingsRow title="子智能体" description="默认跟随主模型">
          <ModelSelect
            value={preferences.childModel}
            options={modelOptions}
            emptyLabel="跟随主模型"
            followValue="follow"
            onChange={(childModel) => onPreferences({ childModel })}
          />
        </SettingsRow>
        <SettingsRow title="上下文压缩" description="优先速度和稳定摘要">
          <ModelSelect
            value={preferences.compactionModel}
            options={modelOptions}
            emptyLabel="跟随主模型"
            followValue="follow"
            onChange={(compactionModel) => onPreferences({ compactionModel })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Provider 与密钥" note="连接、认证与模型发现统一管理">
        {channels.map((channel) => (
          <div className="settings-provider-row" data-testid="channel-row" key={channel.id}>
            <ProviderBrandIcon name={channel.name} baseUrl={channel.baseUrl} />
            <div>
              <strong>{channel.name}</strong>
              <code>{channel.baseUrl}</code>
              <small>
                {channel.secretRef ? '已配置密钥' : '未配置密钥'} · {channel.models.length} 个模型
              </small>
              {testStates[channel.id]?.result && (
                <small
                  data-testid="channel-test-result"
                  className={testStates[channel.id]?.result?.ok ? 'is-success' : 'is-error'}
                >
                  {testStates[channel.id]?.result?.message}
                </small>
              )}
            </div>
            <div className="settings-row-actions">
              <button
                type="button"
                data-testid="channel-test"
                className="settings-text-button"
                onClick={() => onTestChannel(channel.id)}
              >
                {testStates[channel.id]?.running ? '测试中…' : '测试'}
              </button>
              <button
                type="button"
                data-testid="channel-edit"
                className="settings-secondary-button"
                onClick={() => onEditChannel(channel)}
              >
                配置
              </button>
              <button
                type="button"
                data-testid="channel-delete"
                className="settings-text-button is-danger"
                onClick={() => onRemoveChannel(channel.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {channels.length === 0 && (
          <div className="settings-empty-row">还没有 Provider，添加后即可选择模型。</div>
        )}
        <button
          type="button"
          data-testid="channel-add"
          className="settings-add-row"
          onClick={() => onEditChannel()}
        >
          <Plus size={14} />
          添加 Provider
        </button>
      </SettingsSection>

      <SettingsSection title="专家预设" note="可在输入区快速切换">
        {profiles.map((profile) => {
          const channel = channels.find((item) => item.id === profile.channelId)
          return (
            <div className="settings-profile-row" data-testid="profile-row" key={profile.id}>
              <span className="settings-profile-mark">A</span>
              <div>
                <strong>{profile.name}</strong>
                <small>
                  {profile.modelId} · {channel?.name ?? profile.channelId} · {profileSkillLabel(profile)}
                </small>
              </div>
              <button
                type="button"
                data-testid="profile-edit"
                className="settings-secondary-button"
                onClick={() => onEditProfile(profile)}
              >
                编辑
              </button>
              <button
                type="button"
                data-testid="profile-delete"
                className="settings-text-button is-danger"
                onClick={() => onRemoveProfile(profile.id)}
              >
                删除
              </button>
            </div>
          )
        })}
        <button
          type="button"
          data-testid="profile-add"
          className="settings-add-row"
          onClick={() => onEditProfile()}
        >
          <Plus size={14} />
          添加专家预设
        </button>
      </SettingsSection>
    </SettingsContent>
  )
}

function ProviderEditor({
  form,
  channels,
  busy,
  testState,
  onForm,
  onBack,
  onSave,
  onTest,
}: {
  form: ChannelFormState
  channels: Channel[]
  busy: boolean
  testState?: { running: boolean; result?: ChannelTestResult }
  onForm(form: ChannelFormState): void
  onBack(): void
  onSave(): void
  onTest?: () => void
}) {
  return (
    <SettingsContent className="settings-manager-view">
      <ManagerHeader
        backLabel="模型"
        title={form.id ? `配置 ${form.name}` : '添加 Provider'}
        subtitle="连接信息与可用模型"
        onBack={onBack}
        status={testState?.running ? '测试中…' : testState?.result?.ok ? '连接正常' : form.id ? '已保存' : '未保存'}
      />
      <SettingsSection title="连接">
        <div className="settings-form-grid">
          <label>
            <span>显示名称</span>
            <input
              data-testid="channel-name-input"
              value={form.name}
              onChange={(event) => onForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>接口类型</span>
            <select
              data-testid="channel-protocol-input"
              value={form.protocol}
              onChange={(event) =>
                onForm({ ...form, protocol: event.target.value as ChannelProtocol })
              }
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic Compatible</option>
            </select>
          </label>
          <label className="span-2">
            <span>Base URL</span>
            <input
              data-testid="channel-base-url-input"
              value={form.baseUrl}
              placeholder="https://api.deepseek.com"
              onChange={(event) => onForm({ ...form, baseUrl: event.target.value })}
            />
          </label>
          <label className="span-2">
            <span>API Key</span>
            <input
              data-testid="channel-key-input"
              type="password"
              value={form.apiKey}
              placeholder={
                channelConfigured(form.id, channels)
                  ? '已保存在系统钥匙串；留空则不修改'
                  : '输入 API Key'
              }
              onChange={(event) => onForm({ ...form, apiKey: event.target.value })}
            />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="模型" note="连接成功后自动发现，也可以手动刷新">
        <div className="settings-model-list">
          {form.models.map((model, index) => (
            <div key={model.id}>
              <code>{model.name}</code>
              {index === 0 && <span className="settings-quiet-badge">默认</span>}
            </div>
          ))}
          {form.models.length === 0 && (
            <div className="settings-empty-row">保存并测试连接后发现模型。</div>
          )}
        </div>
      </SettingsSection>

      {testState?.result && (
        <p className={testState.result.ok ? 'settings-success-copy' : 'settings-error-copy'}>
          {testState.result.message}
        </p>
      )}
      <div className="settings-editor-actions">
        <button
          type="button"
          className="settings-secondary-button"
          disabled={!onTest || testState?.running}
          onClick={onTest}
        >
          <RefreshCw size={13} />
          {testState?.running ? '正在测试…' : form.id ? '测试并同步模型' : '保存后测试'}
        </button>
        <button
          type="button"
          data-testid="channel-save"
          className="settings-primary-button"
          disabled={busy || !form.name.trim() || !form.baseUrl.trim()}
          onClick={onSave}
        >
          保存
        </button>
      </div>
      <p className="settings-footnote">API Key 仅写入本机系统钥匙串；界面不会回传明文。</p>
    </SettingsContent>
  )
}

function ProfileEditor({
  form,
  channels,
  skillGroups,
  busy,
  onForm,
  onBack,
  onSave,
}: {
  form: ProfileFormState
  channels: Channel[]
  skillGroups: SkillGroupView[]
  busy: boolean
  onForm(form: ProfileFormState): void
  onBack(): void
  onSave(): void
}) {
  const models = channels.find((channel) => channel.id === form.channelId)?.models ?? []
  const skills = skillGroups.flatMap((group) =>
    group.items.map((skill) => ({ ...skill, sourceLabel: group.title })),
  )

  function toggleSkill(skillId: string): void {
    const selected = form.skillIds ?? []
    onForm({
      ...form,
      skillIds: selected.includes(skillId)
        ? selected.filter((id) => id !== skillId)
        : [...selected, skillId],
    })
  }
  return (
    <SettingsContent className="settings-manager-view">
      <ManagerHeader
        backLabel="模型"
        title={form.id ? `编辑 ${form.name}` : '添加专家预设'}
        subtitle="模型、指令与可用技能"
        onBack={onBack}
      />
      <SettingsSection title="专家">
        <div className="settings-form-grid">
          <label>
            <span>名称</span>
            <input
              data-testid="profile-name-input"
              value={form.name}
              placeholder="风险分析专家"
              onChange={(event) => onForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>Provider</span>
            <select
              data-testid="profile-channel-input"
              value={form.channelId}
              onChange={(event) =>
                onForm({ ...form, channelId: event.target.value, modelId: '' })
              }
            >
              <option value="">选择 Provider</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          </label>
          <label className="span-2">
            <span>模型</span>
            <select
              data-testid="profile-model-input"
              value={form.modelId}
              onChange={(event) => onForm({ ...form, modelId: event.target.value })}
            >
              <option value="">选择模型</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label className="span-2">
            <span>系统提示词（可选）</span>
            <textarea
              data-testid="profile-prompt-input"
              rows={5}
              value={form.systemPrompt}
              onChange={(event) => onForm({ ...form, systemPrompt: event.target.value })}
            />
          </label>
        </div>
      </SettingsSection>
      <SettingsSection title="可用技能" note="只影响新的 Run；技能正文仍按需加载">
        <div className="settings-skill-mode">
          <button
            type="button"
            className={form.skillIds === undefined ? 'active' : ''}
            onClick={() => onForm({ ...form, skillIds: undefined })}
          >
            <strong>自动匹配</strong>
            <small>使用所有应用级已启用技能，由 Agent 按任务选择</small>
          </button>
          <button
            type="button"
            className={form.skillIds !== undefined ? 'active' : ''}
            onClick={() => onForm({ ...form, skillIds: form.skillIds ?? [] })}
          >
            <strong>指定技能</strong>
            <small>该专家只看见你选择的技能</small>
          </button>
        </div>
        {form.skillIds !== undefined && (
          <div className="settings-profile-skills" data-testid="profile-skill-picker">
            {skills.map((skill) => {
              const selected = form.skillIds?.includes(skill.id) ?? false
              return (
                <button
                  type="button"
                  key={skill.id}
                  disabled={!skill.enabled}
                  className={selected ? 'selected' : ''}
                  onClick={() => toggleSkill(skill.id)}
                >
                  <span className="settings-skill-check">{selected ? <Check size={12} /> : null}</span>
                  <span>
                    <strong>{skill.title}</strong>
                    <small>{skill.description}</small>
                  </span>
                  <em>{skill.enabled ? skill.sourceLabel : '应用级已关闭'}</em>
                </button>
              )
            })}
            {skills.length === 0 && (
              <div className="settings-empty-row">还没有可用技能，可先到“能力”中安装或启用。</div>
            )}
          </div>
        )}
      </SettingsSection>
      <div className="settings-editor-actions">
        <button type="button" className="settings-secondary-button" onClick={onBack}>取消</button>
        <button
          type="button"
          data-testid="profile-save"
          className="settings-primary-button"
          disabled={busy}
          onClick={onSave}
        >
          保存
        </button>
      </div>
    </SettingsContent>
  )
}

function profileSkillLabel(profile: Profile): string {
  if (profile.skillIds === undefined) return '技能自动匹配'
  if (profile.skillIds.length === 0) return '不使用技能'
  return `${profile.skillIds.length} 个技能`
}

function PermissionSettings({
  preferences,
  rules,
  confirmingRuleId,
  onPreferences,
  onConfirmRule,
  onRevokeRule,
}: {
  preferences: SettingsPreferences
  rules: PermissionRule[]
  confirmingRuleId: string | null
  onPreferences(patch: Partial<SettingsPreferences>): void
  onConfirmRule(ruleId: string | null): void
  onRevokeRule(ruleId: string): void
}) {
  return (
    <SettingsContent>
      <SettingsSection title="默认权限模式" note="只影响新会话；运行中可在输入框切换">
        <div className="settings-mode-grid">
          {MODE_OPTIONS.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={preferences.defaultPermissionMode === mode.id ? 'active' : ''}
              onClick={() => onPreferences({ defaultPermissionMode: mode.id })}
            >
              <strong>{mode.label}</strong>
              <small>{mode.description}</small>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="已记住的授权"
        note="由授权卡中的“总是允许”生成；仍按会话或工作区隔离"
      >
        {rules.length === 0 && (
          <div className="settings-empty-rule">
            <Check size={16} />
            <span>
              <strong>没有已记住的授权</strong>
              <small>写入与命令会继续按当前权限模式询问。</small>
            </span>
          </div>
        )}
        {rules.map((rule) => (
          <div className="settings-rule-row" key={rule.id}>
            <code>{rule.tool}</code>
            <span>
              <strong>{rule.pattern}</strong>
              <small>{formatRuleMeta(rule)}</small>
            </span>
            {confirmingRuleId === rule.id ? (
              <div className="settings-inline-confirm">
                <small>撤销后下次会重新询问</small>
                <button type="button" onClick={() => onConfirmRule(null)}>取消</button>
                <button type="button" className="is-danger" onClick={() => onRevokeRule(rule.id)}>
                  确认撤销
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="settings-text-button"
                onClick={() => onConfirmRule(rule.id)}
              >
                撤销
              </button>
            )}
          </div>
        ))}
      </SettingsSection>

      <SettingsSection title="工具默认行为" note="系统安全基线，只读展示">
        <div className="settings-readonly-grid">
          <span><b>读取类</b><small>默认直接执行</small></span>
          <span><b>写入与命令</b><small>默认每次询问</small></span>
          <span><b>高危不可逆</b><small>始终模态确认</small></span>
        </div>
      </SettingsSection>
    </SettingsContent>
  )
}

function CapabilitySettings({
  skillGroups,
  mcpServers,
  statuses,
  onManage,
}: {
  skillGroups: SkillGroupView[]
  mcpServers: McpServerConfig[]
  statuses: Record<string, McpServerStatus>
  onManage(manager: Exclude<CapabilityManager, null>): void
}) {
  const enabledSkills = skillGroups.flatMap((group) => group.items).filter((skill) => skill.enabled)
  const online = Object.values(statuses).filter((status) => status.state === 'connected').length
  const errors = Object.values(statuses).filter((status) => status.state === 'error').length
  return (
    <SettingsContent>
      <div className="settings-callout">
        <Check size={17} />
        <div>
          <strong>能力是应用级配置</strong>
          <p>Skill 与 MCP 对所有工作区可见；每次 Run 仍只加载任务需要的能力。</p>
        </div>
      </div>
      <div className="settings-capability-row" data-testid="capability-skill">
        <span className="settings-status-dot is-online" />
        <div>
          <strong>技能</strong>
          <small>{enabledSkills.length} 个已启用</small>
          <p>应用级能力 · 所有工作区共用</p>
        </div>
        <button type="button" className="settings-secondary-button" onClick={() => onManage('skills')}>
          管理
        </button>
      </div>
      <div className="settings-capability-row" data-testid="capability-mcp">
        <span className={`settings-status-dot ${errors > 0 ? 'is-warning' : 'is-online'}`} />
        <div>
          <strong>MCP 服务</strong>
          <small>{online} 在线{errors > 0 ? ` · ${errors} 异常` : ''}</small>
          <p>应用级连接 · 运行时按需暴露工具</p>
        </div>
        <button type="button" className="settings-secondary-button" onClick={() => onManage('mcp')}>
          管理
        </button>
      </div>
      {mcpServers.length === 0 && (
        <p className="settings-footnote">尚未添加 MCP 服务；可以进入管理页创建 stdio 或 HTTP 连接。</p>
      )}
    </SettingsContent>
  )
}

function SkillManager({
  skillGroups,
  onBack,
  onToggle,
}: {
  skillGroups: SkillGroupView[]
  onBack(): void
  onToggle(skillId: string, enabled: boolean): void
}) {
  const [query, setQuery] = useState('')
  const skills = skillGroups.flatMap((group) =>
    group.items.map((skill) => ({ ...skill, sourceLabel: group.title })),
  )
  const visible = skills.filter((skill) =>
    `${skill.title} ${skill.description} ${skill.name}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <SettingsContent className="settings-manager-view">
      <ManagerHeader
        backLabel="应用能力"
        title="技能"
        subtitle={`${skills.filter((skill) => skill.enabled).length} 个技能已启用`}
        onBack={onBack}
      />
      <label className="settings-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" />
      </label>
      <div className="settings-manager-list">
        {visible.map((skill) => (
          <div className="settings-manager-row" data-testid="skill-row" key={skill.id}>
            <span className="settings-skill-mark">S</span>
            <div>
              <strong>{skill.title}</strong>
              <small>{skill.description}</small>
              <em>{skill.sourceLabel} · 对所有工作区可用</em>
            </div>
            <Switch
              checked={skill.enabled}
              label={skill.title}
              testId={`skill-toggle-${skill.name}`}
              onChange={(enabled) => onToggle(skill.id, enabled)}
            />
          </div>
        ))}
        {visible.length === 0 && <div className="settings-empty-row">没有匹配的技能。</div>}
      </div>
      <p className="settings-footnote">关闭技能不会删除文件；新的 Run 不再加载它，正在运行的任务不受影响。</p>
    </SettingsContent>
  )
}

function McpManager({
  servers,
  statuses,
  tools,
  onBack,
  onAdd,
  onEdit,
  onRemove,
  onConnect,
  onDisconnect,
}: {
  servers: McpServerConfig[]
  statuses: Record<string, McpServerStatus>
  tools: ToolSettingView[]
  onBack(): void
  onAdd(): void
  onEdit(server: McpServerConfig): void
  onRemove(serverId: string): void
  onConnect(serverId: string): void
  onDisconnect(serverId: string): void
}) {
  const online = Object.values(statuses).filter((status) => status.state === 'connected').length
  return (
    <SettingsContent className="settings-manager-view">
      <ManagerHeader
        backLabel="应用能力"
        title="MCP 服务"
        subtitle={`${online} 个服务在线`}
        onBack={onBack}
        action={(
          <button type="button" data-testid="mcp-add" className="settings-secondary-button" onClick={onAdd}>
            <Plus size={13} />添加服务
          </button>
        )}
      />
      <div className="settings-manager-list">
        {servers.map((server) => {
          const status = statuses[server.id] ?? { serverId: server.id, state: 'off' as const }
          const serverTools = tools.filter((tool) => tool.id.startsWith(`${server.key}.`))
          return (
            <div className="settings-manager-row" data-testid="mcp-row" key={server.id}>
              <span className={`settings-status-dot ${statusClass(status.state)}`} />
              <div>
                <strong>{server.name}</strong>
                <small>{server.transport === 'stdio' ? server.command : server.url}</small>
                <em>{serverTools.length} 个工具 · 应用级连接</em>
                {status.state === 'error' && status.error && (
                  <em className="is-error" data-testid="mcp-error">{status.error}</em>
                )}
              </div>
              <span className={`settings-status-label ${statusClass(status.state)}`}>
                {statusLabel(status.state)}
              </span>
              {status.state === 'connected' ? (
                <button type="button" data-testid="mcp-disconnect" className="settings-secondary-button" onClick={() => onDisconnect(server.id)}>
                  断开
                </button>
              ) : (
                <button type="button" data-testid="mcp-connect" className="settings-secondary-button" disabled={!server.enabled || status.state === 'connecting'} onClick={() => onConnect(server.id)}>
                  {status.state === 'error' ? '重试' : status.state === 'connecting' ? '连接中…' : '连接'}
                </button>
              )}
              <button type="button" data-testid="mcp-edit" className="settings-text-button" onClick={() => onEdit(server)}>编辑</button>
              <button type="button" data-testid="mcp-delete" className="settings-text-button is-danger" onClick={() => onRemove(server.id)}>删除</button>
              <McpTools server={server} tools={serverTools} />
            </div>
          )
        })}
        {servers.length === 0 && <div className="settings-empty-row">还没有 MCP 服务。</div>}
      </div>
      <p className="settings-footnote">服务连接对所有工作区共用；具体工具是否可执行仍受当前权限模式控制。</p>
    </SettingsContent>
  )
}

function McpTools({ server, tools }: { server: McpServerConfig; tools: ToolSettingView[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="settings-mcp-tools">
      <button type="button" data-testid="mcp-tools-toggle" onClick={() => setOpen((current) => !current)}>
        {open ? '收起' : '查看'} {tools.length} 个工具
      </button>
      {open && (
        <div>
          {tools.map((tool) => (
            <span data-testid="mcp-tool-row" key={tool.id}>
              <code>{tool.id}</code><small>{permissionLabel(tool.permission)}</small>
            </span>
          ))}
          {tools.length === 0 && <small>{server.name} 连接后自动发现工具</small>}
        </div>
      )}
    </div>
  )
}

function McpEditor({
  form,
  busy,
  onForm,
  onBack,
  onSave,
}: {
  form: McpFormState
  busy: boolean
  onForm(form: McpFormState): void
  onBack(): void
  onSave(): void
}) {
  return (
    <SettingsContent className="settings-manager-view">
      <ManagerHeader
        backLabel="MCP 服务"
        title={form.id ? `配置 ${form.name}` : '添加 MCP 服务'}
        subtitle="应用级连接与运行时工具发现"
        onBack={onBack}
      />
      <SettingsSection title="连接">
        <div className="settings-form-grid">
          <label>
            <span>名称</span>
            <input data-testid="mcp-name-input" value={form.name} onChange={(event) => onForm({ ...form, name: event.target.value })} placeholder="postgres · prod-read" />
          </label>
          <label>
            <span>服务标识</span>
            <input data-testid="mcp-key-input" value={form.key} onChange={(event) => onForm({ ...form, key: event.target.value })} placeholder="postgres" />
          </label>
          <label>
            <span>传输</span>
            <select data-testid="mcp-transport-input" value={form.transport} onChange={(event) => onForm({ ...form, transport: event.target.value as 'stdio' | 'http' })}>
              <option value="stdio">stdio（本地进程）</option>
              <option value="http">HTTP / SSE</option>
            </select>
          </label>
          <label>
            <span>状态</span>
            <select data-testid="mcp-enabled-input" value={form.enabled ? 'enabled' : 'disabled'} onChange={(event) => onForm({ ...form, enabled: event.target.value === 'enabled' })}>
              <option value="enabled">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          {form.transport === 'stdio' ? (
            <>
              <label className="span-2">
                <span>启动命令</span>
                <input data-testid="mcp-command-input" value={form.command} onChange={(event) => onForm({ ...form, command: event.target.value })} placeholder="node scripts/mcp-server.mjs" />
              </label>
              <label className="span-2">
                <span>参数（空格分隔，可选）</span>
                <input data-testid="mcp-args-input" value={form.args} onChange={(event) => onForm({ ...form, args: event.target.value })} />
              </label>
            </>
          ) : (
            <label className="span-2">
              <span>服务 URL</span>
              <input data-testid="mcp-url-input" value={form.url} onChange={(event) => onForm({ ...form, url: event.target.value })} placeholder="https://mcp.example.com/sse" />
            </label>
          )}
          <label className="span-2">
            <span>环境变量（每行 KEY=VALUE，可用 secret:&lt;ref&gt;）</span>
            <textarea data-testid="mcp-env-input" rows={5} value={form.env} onChange={(event) => onForm({ ...form, env: event.target.value })} />
          </label>
        </div>
      </SettingsSection>
      <div className="settings-editor-actions">
        <button type="button" className="settings-secondary-button" onClick={onBack}>取消</button>
        <button type="button" data-testid="mcp-save" className="settings-primary-button" disabled={busy} onClick={onSave}>保存</button>
      </div>
    </SettingsContent>
  )
}

function AppearanceSettings({
  theme,
  onToggleTheme,
}: {
  theme: ThemeName
  onToggleTheme(): void
}) {
  return (
    <SettingsContent>
      <SettingsSection title="主题">
        <div className="settings-appearance-grid">
          <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => theme !== 'light' && onToggleTheme()}>
            <div className="settings-theme-preview is-light" />
            <strong>明亮</strong><small>纸白工作台</small>
          </button>
          <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => theme !== 'dark' && onToggleTheme()}>
            <div className="settings-theme-preview is-dark" />
            <strong>深色</strong><small>暖炭灰界面</small>
          </button>
        </div>
      </SettingsSection>
    </SettingsContent>
  )
}

function SettingsContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`settings-content ${className}`}>{children}</div>
}

function SettingsSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-title"><strong>{title}</strong>{note && <small>{note}</small>}</div>
      <div className="settings-group">{children}</div>
    </section>
  )
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <div>{children}</div>
    </div>
  )
}

function Switch({
  checked,
  label,
  testId,
  onChange,
}: {
  checked: boolean
  label: string
  testId?: string
  onChange(checked: boolean): void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      data-testid={testId}
      className={`settings-switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}

function ModelSelect({
  value,
  options,
  emptyLabel,
  followValue = '',
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  emptyLabel: string
  followValue?: string
  onChange(value: string): void
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value={followValue}>{emptyLabel}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

function ManagerHeader({
  backLabel,
  title,
  subtitle,
  status,
  action,
  onBack,
}: {
  backLabel: string
  title: string
  subtitle: string
  status?: string
  action?: ReactNode
  onBack(): void
}) {
  return (
    <div className="settings-manager-head">
      <button type="button" className="settings-back-button" onClick={onBack}>
        <ChevronLeft size={14} />{backLabel}
      </button>
      <div><strong>{title}</strong><small>{subtitle}</small></div>
      {status && <span className="settings-status-label">{status}</span>}
      {action}
    </div>
  )
}

function channelConfigured(channelId: string | undefined, channels: Channel[]): boolean {
  return Boolean(channels.find((channel) => channel.id === channelId)?.secretRef)
}

function formatRuleMeta(rule: PermissionRule): string {
  const scope = rule.scope === 'project' ? '工作区' : rule.scope === 'session' ? '会话' : '全局'
  const match = rule.match === 'path' ? '路径规则' : rule.match === 'prefix' ? '命令前缀' : rule.match === 'method' ? 'MCP 方法' : '工具规则'
  const date = new Date(rule.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${scope} · ${match} · ${date} · 命中 ${rule.hits} 次`
}

function statusClass(state: McpServerStatus['state']): string {
  if (state === 'connected') return 'is-online'
  if (state === 'error') return 'is-warning'
  if (state === 'connecting') return 'is-running'
  return 'is-off'
}

function statusLabel(state: McpServerStatus['state']): string {
  if (state === 'connected') return '已连接'
  if (state === 'error') return '异常'
  if (state === 'connecting') return '连接中'
  return '未连接'
}

function permissionLabel(permission: ToolSettingView['permission']): string {
  if (permission === 'allow') return '允许'
  if (permission === 'deny') return '禁止'
  return '询问'
}
