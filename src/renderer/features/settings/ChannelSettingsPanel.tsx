import { useEffect, useState } from 'react'
import type {
  Channel,
  ChannelModel,
  ChannelProtocol,
  ChannelSaveInput,
  ChannelTestResult,
} from '../../../shared/contracts/channel.ts'
import { ProviderBrandIcon } from './ProviderBrandIcon.tsx'
import type { Profile, ProfileSaveInput } from '../../../shared/contracts/profile.ts'
import type {
  ToolPermission,
  ToolSettingView,
} from '../../../shared/contracts/tool.ts'
import type { SkillGroupView } from '../../../shared/contracts/skill.ts'
import type {
  McpSaveInput,
  McpServerConfig,
  McpServerStatus,
} from '../../../shared/contracts/mcp.ts'

export interface ChannelSettingsPanelProps {
  workspaceId?: string | null
  onClose(): void
}

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

const EMPTY_FORM: ChannelFormState = {
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

/**
 * 设置页「模型与密钥」的最小 feature（C02）：渠道 CRUD。
 * 密钥输入只在本组件内存里存在，保存后主进程写入 SecretStore；
 * 列表结果只显示「已配置/未配置」状态，不回传明文。
 */
export function ChannelSettingsPanel(props: ChannelSettingsPanelProps) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [tools, setTools] = useState<ToolSettingView[]>([])
  const [skillGroups, setSkillGroups] = useState<SkillGroupView[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpServerStatus>>({})
  const [mcpForm, setMcpForm] = useState<McpFormState>(EMPTY_MCP_FORM)
  const [editingMcpId, setEditingMcpId] = useState<string | null>(null)
  const [form, setForm] = useState<ChannelFormState>(EMPTY_FORM)
  const [profileForm, setProfileForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [testStates, setTestStates] = useState<
    Record<string, { running: boolean; result?: ChannelTestResult }>
  >({})

  const refresh = async (): Promise<void> => {
    const [channelList, profileList, toolList, skillList, mcpList, statusList] =
      await Promise.all([
      window.tgbuddy.channel.list(),
      window.tgbuddy.profile.list(),
      window.tgbuddy.tool.list(),
      window.tgbuddy.skill.list(props.workspaceId ?? undefined),
      window.tgbuddy.mcp.list(),
      window.tgbuddy.mcp.status(),
      ])
    setChannels(channelList)
    setProfiles(profileList)
    // 工具区已从设置页移除：内置工具不再展示，只保留 MCP 工具供服务卡展开
    setTools(toolList.filter((tool) => tool.category === 'mcp'))
    setSkillGroups(skillList)
    setMcpServers(mcpList)
    setMcpStatuses(
      Object.fromEntries(statusList.map((status) => [status.serverId, status])),
    )
  }

  useEffect(() => {
    void refresh()
  }, [props.workspaceId])

  function startEdit(channel?: Channel) {
    // 空串表示「新建」：与 null（未在编辑）区分，否则新建表单永不显示。
    setEditingId(channel?.id ?? '')
    setForm(
      channel
        ? {
            id: channel.id,
            name: channel.name,
            protocol: channel.protocol,
            baseUrl: channel.baseUrl,
            apiKey: '',
            models: channel.models,
          }
        : EMPTY_FORM,
    )
    setError(undefined)
  }

  async function save() {
    const name = form.name.trim()
    const baseUrl = form.baseUrl.trim()
    if (!name || !baseUrl) {
      setError('渠道名称和 Base URL 不能为空')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const input: ChannelSaveInput = {
        ...(form.id ? { id: form.id } : {}),
        name,
        protocol: form.protocol,
        baseUrl,
        apiKey: form.apiKey.trim() || undefined,
        models: form.models,
      }
      await window.tgbuddy.channel.save(input)
      setEditingId(null)
      setForm(EMPTY_FORM)
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  function startEditProfile(profile?: Profile) {
    setEditingProfileId(profile?.id ?? '')
    setProfileForm(
      profile
        ? {
            id: profile.id,
            name: profile.name,
            channelId: profile.channelId,
            modelId: profile.modelId,
            systemPrompt: profile.systemPrompt ?? '',
          }
        : EMPTY_PROFILE_FORM,
    )
    setError(undefined)
  }

  async function saveProfile() {
    const name = profileForm.name.trim()
    if (!name || !profileForm.channelId || !profileForm.modelId) {
      setError('Profile 名称、渠道和模型不能为空')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const input: ProfileSaveInput = {
        ...(profileForm.id ? { id: profileForm.id } : {}),
        name,
        channelId: profileForm.channelId,
        modelId: profileForm.modelId,
        ...(profileForm.systemPrompt.trim()
          ? { systemPrompt: profileForm.systemPrompt.trim() }
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

  async function removeProfile(profileId: string) {
    if (!window.confirm('删除该 Profile 后，选中它的会话将回退到直接模型选择。确认删除？')) return
    setBusy(true)
    setError(undefined)
    try {
      await window.tgbuddy.profile.delete(profileId)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  function startEditMcp(server?: McpServerConfig) {
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

  async function saveMcp() {
    const name = mcpForm.name.trim()
    if (!name) {
      setError('MCP 服务名称不能为空')
      return
    }
    const env: Record<string, string> = {}
    for (const line of mcpForm.env.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
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
        : {
            url: mcpForm.url.trim(),
          }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    }
    setBusy(true)
    setError(undefined)
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

  async function connectMcp(serverId: string) {
    const status = await window.tgbuddy.mcp.connect(serverId)
    setMcpStatuses((current) => ({ ...current, [serverId]: status }))
    // 连接成功后发现的工具已进注册表，刷新设置页工具列表。
    await refresh()
  }

  async function disconnectMcp(serverId: string) {
    await window.tgbuddy.mcp.disconnect(serverId)
    setMcpStatuses((current) => ({
      ...current,
      [serverId]: { serverId, state: 'off' },
    }))
    // 断开后工具已从注册表移除，刷新设置页工具列表保持一致。
    await refresh()
  }

  async function removeMcp(serverId: string) {
    if (!window.confirm('删除该 MCP 服务并断开连接？')) return
    setBusy(true)
    setError(undefined)
    try {
      await window.tgbuddy.mcp.delete(serverId)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function remove(channelId: string) {
    if (!window.confirm('删除该渠道后，使用它的会话将无法继续运行。确认删除？')) return
    setBusy(true)
    setError(undefined)
    try {
      await window.tgbuddy.channel.delete(channelId)
      await refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function testChannel(channelId: string) {
    setTestStates((current) => ({
      ...current,
      [channelId]: { running: true },
    }))
    try {
      const result = await window.tgbuddy.channel.test(channelId)
      setTestStates((current) => ({
        ...current,
        [channelId]: { running: false, result },
      }))
      await refresh()
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

  function cancelTest(channelId: string) {
    // 主进程请求无法中断，这里先放弃等待展示；下一次测试覆盖旧状态。
    setTestStates((current) => ({ ...current, [channelId]: { running: false } }))
  }

  return (
    <div
      data-testid="channel-settings-panel"
      className="fixed inset-0 z-30 flex items-start justify-end bg-black/40"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
        <div className="flex h-full w-[420px] flex-col border-l border-white/5 bg-background shadow-2xl">
          <div className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-foreground">模型与密钥</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                密钥只存在本机钥匙串，不写进配置文件、不随会话导出。
              </div>
            </div>
            <button
              type="button"
              data-testid="channel-settings-close"
              onClick={props.onClose}
              className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent/60"
            >
              关闭
            </button>
          </div>
        </div>

        {error && (
          <div
            data-testid="settings-error"
            className="mx-4 mt-3 rounded-md bg-red-950/50 px-3 py-2 text-[11.5px] text-[#c9635b]"
          >
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <span className="text-[11px] tracking-wide text-[#6d6d75]">密钥与端点</span>
            <div className="h-px flex-1 bg-white/5" />
            <button
              type="button"
              data-testid="channel-add"
              onClick={() => startEdit()}
              className="rounded-md px-2 py-1 text-[11px] text-sky-300 hover:bg-accent/60"
            >
              + 添加渠道
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {channels.length === 0 && !editingId && (
              <div className="rounded-[10px] bg-[#17171a] px-3 py-4 text-center text-[11.5px] text-[#63636b]">
                还没有配置任何渠道。点击右上角「添加渠道」。
              </div>
            )}
            {channels.map((channel) => (
              <div
                key={channel.id}
                data-testid="channel-row"
                className="flex flex-col gap-1 rounded-[10px] bg-[#17171a] px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <ProviderBrandIcon name={channel.name} baseUrl={channel.baseUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] text-[#e4e4e9]">{channel.name}</span>
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: channel.secretRef ? '#8fc6a5' : '#777780' }}
                      />
                    </div>
                    <div className="truncate font-mono text-[11px] text-[#8a8a92]">
                      {channel.baseUrl}
                    </div>
                  </div>
                  <span className="flex-none font-mono text-[11px] text-[#8a8a92]">
                    {channel.secretRef ? '已配置密钥' : '未配置密钥'}
                  </span>
                  <button
                    type="button"
                    data-testid="channel-edit"
                    onClick={() => startEdit(channel)}
                    className="flex-none rounded-md px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10"
                  >
                    编辑
                  </button>
                  {testStates[channel.id]?.running ? (
                    <button
                      type="button"
                      data-testid="channel-test-cancel"
                      onClick={() => cancelTest(channel.id)}
                      className="flex-none rounded-md px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10"
                    >
                      取消
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="channel-test"
                      onClick={() => void testChannel(channel.id)}
                      className="flex-none rounded-md px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10"
                    >
                      测试连接
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="channel-delete"
                    onClick={() => remove(channel.id)}
                    className="flex-none rounded-md px-2 py-1 text-[11px] text-[#c9635b] hover:bg-white/10"
                  >
                    删除
                  </button>
                </div>
                {testStates[channel.id]?.result && !testStates[channel.id]?.running && (
                  <div
                    data-testid="channel-test-result"
                    className={`text-[11px] ${
                      testStates[channel.id]?.result?.ok
                        ? 'text-[#8fc6a5]'
                        : 'text-[#c9635b]'
                    }`}
                  >
                    {testStates[channel.id]?.result?.message}
                  </div>
                )}
              </div>
            ))}
          </div>

          {editingId !== null && (
            <div className="mt-4 flex flex-col gap-2.5 rounded-[10px] bg-[#17171a] p-3">
              <div className="text-[12.5px] text-[#e4e4e9]">
                {form.id ? '编辑渠道' : '新渠道'}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">名称</span>
                <input
                  data-testid="channel-name-input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">协议</span>
                <select
                  data-testid="channel-protocol-input"
                  value={form.protocol}
                  onChange={(event) =>
                    setForm({ ...form, protocol: event.target.value as ChannelProtocol })
                  }
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                >
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">Base URL</span>
                <input
                  data-testid="channel-base-url-input"
                  value={form.baseUrl}
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                  placeholder="https://api.deepseek.com"
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">
                  API Key{channelConfigured(form.id, channels) ? '（留空保留原密钥）' : ''}
                </span>
                <input
                  data-testid="channel-key-input"
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                  placeholder="sk-…"
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <div className="text-[11px] text-[#63636b]">
                密钥经系统加密保存；模型列表可在保存后通过「测试连接」刷新。
              </div>
              {error && (
                <div className="text-[11.5px] text-[#c9635b]">{error}</div>
              )}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  data-testid="channel-save"
                  disabled={busy}
                  onClick={() => void save()}
                  className="flex-1 rounded-md bg-sky-500/80 px-2 py-1.5 text-[12px] text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null)
                    setForm(EMPTY_FORM)
                    setError(undefined)
                  }}
                  className="rounded-md bg-white/5 px-3 py-1.5 text-[12px] text-[#b6b6be] hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="mb-2 mt-5 flex items-center gap-2 px-0.5">
            <span className="text-[11px] tracking-wide text-[#6d6d75]">Profile / 专家</span>
            <div className="h-px flex-1 bg-white/5" />
            <button
              type="button"
              data-testid="profile-add"
              onClick={() => startEditProfile()}
              className="rounded-md px-2 py-1 text-[11px] text-sky-300 hover:bg-accent/60"
            >
              + 添加 Profile
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {profiles.map((profile) => {
              const channel = channels.find((item) => item.id === profile.channelId)
              return (
                <div
                  key={profile.id}
                  data-testid="profile-row"
                  className="flex items-center gap-3 rounded-[10px] bg-[#17171a] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-[#e4e4e9]">{profile.name}</div>
                    <div className="truncate font-mono text-[11px] text-[#8a8a92]">
                      {profile.modelId} · {channel?.name ?? profile.channelId}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="profile-edit"
                    onClick={() => startEditProfile(profile)}
                    className="flex-none rounded-md px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    data-testid="profile-delete"
                    onClick={() => removeProfile(profile.id)}
                    className="flex-none rounded-md px-2 py-1 text-[11px] text-[#c9635b] hover:bg-white/10"
                  >
                    删除
                  </button>
                </div>
              )
            })}
            {profiles.length === 0 && !editingProfileId && (
              <div className="rounded-[10px] bg-[#17171a] px-3 py-4 text-center text-[11.5px] text-[#63636b]">
                还没有 Profile。可以把常用的「渠道 + 模型」存成命名预设。
              </div>
            )}
          </div>

          {editingProfileId !== null && (
            <div className="mt-4 flex flex-col gap-2.5 rounded-[10px] bg-[#17171a] p-3">
              <div className="text-[12.5px] text-[#e4e4e9]">
                {profileForm.id ? '编辑 Profile' : '新 Profile'}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">名称</span>
                <input
                  data-testid="profile-name-input"
                  value={profileForm.name}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, name: event.target.value })
                  }
                  placeholder="风险分析专家"
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">渠道</span>
                <select
                  data-testid="profile-channel-input"
                  value={profileForm.channelId}
                  onChange={(event) => {
                    const channelId = event.target.value
                    setProfileForm({
                      ...profileForm,
                      channelId,
                      modelId: '',
                    })
                  }}
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                >
                  <option value="">选择渠道</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">模型</span>
                <select
                  data-testid="profile-model-input"
                  value={profileForm.modelId}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, modelId: event.target.value })
                  }
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                >
                  <option value="">选择模型</option>
                  {channels
                    .find((channel) => channel.id === profileForm.channelId)
                    ?.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">系统提示词（可选）</span>
                <textarea
                  data-testid="profile-prompt-input"
                  value={profileForm.systemPrompt}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, systemPrompt: event.target.value })
                  }
                  rows={2}
                  className="resize-none rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  data-testid="profile-save"
                  disabled={busy}
                  onClick={() => void saveProfile()}
                  className="flex-1 rounded-md bg-sky-500/80 px-2 py-1.5 text-[12px] text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingProfileId(null)
                    setProfileForm(EMPTY_PROFILE_FORM)
                    setError(undefined)
                  }}
                  className="rounded-md bg-white/5 px-3 py-1.5 text-[12px] text-[#b6b6be] hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="mb-2 mt-5 flex items-center gap-2 px-0.5">
            <span className="text-[11px] tracking-wide text-[#6d6d75]">技能</span>
            <div className="h-px flex-1 bg-white/5" />
            <span className="text-[10.5px] text-[#63636b]">
              按来源分组，工作区技能随工作区切换
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {skillGroups.map((group) => (
              <div key={group.source} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 px-0.5">
                  <span className="text-[11px] text-[#6d6d75]">{group.title}</span>
                  <div className="h-px flex-1 bg-white/5" />
                  <span className="text-[10.5px] text-[#63636b]">
                    {group.items.filter((skill) => skill.enabled).length} 已启用
                  </span>
                </div>
                {group.items.map((skill) => (
                  <div
                    key={skill.id}
                    data-testid="skill-row"
                    className={`flex items-center gap-3 rounded-[10px] bg-[#17171a] px-3 py-2.5 ${
                      skill.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] text-[#e4e4e9]">
                          {skill.title}
                        </span>
                        {skill.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                              background: 'rgba(224,163,62,.14)',
                              color: '#e0c39e',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="truncate text-[11px] text-[#75757e]">
                        {skill.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={skill.enabled}
                      data-testid={`skill-toggle-${skill.name}`}
                      onClick={() =>
                        void window.tgbuddy.skill
                          .setEnabled(skill.id, !skill.enabled)
                          .then(() => refresh())
                      }
                      className="flex h-5 w-9 flex-none items-center rounded-full px-0.5 transition-colors"
                      style={{
                        background: skill.enabled
                          ? 'rgba(176,162,224,.8)'
                          : 'rgba(255,255,255,.12)',
                        justifyContent: skill.enabled ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <span className="h-4 w-4 rounded-full bg-white/90 shadow" />
                    </button>
                  </div>
                ))}
                {group.items.length === 0 && (
                  <div className="rounded-[10px] bg-[#17171a] px-3 py-3 text-center text-[11.5px] text-[#63636b]">
                    暂无{group.title}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mb-2 mt-5 flex items-center gap-2 px-0.5">
            <span className="text-[11px] tracking-wide text-[#6d6d75]">
              连接器（MCP）
            </span>
            <div className="h-px flex-1 bg-white/5" />
            <button
              type="button"
              data-testid="mcp-add"
              onClick={() => startEditMcp()}
              className="rounded-md px-2 py-1 text-[11px] text-sky-300 hover:bg-accent/60"
            >
              + 添加连接器
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {mcpServers.map((server) => {
              const status = mcpStatuses[server.id] ?? {
                serverId: server.id,
                state: 'off',
              }
              const meta = MCP_STATUS_META[status.state]
              return (
                <div
                  key={server.id}
                  data-testid="mcp-row"
                  className="flex flex-col gap-2 rounded-[10px] bg-[#17171a] px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-[7px] w-[7px] flex-none rounded-full"
                      style={{ background: meta.dot }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-[#e4e4e9]">
                        {server.name}
                        {!server.enabled && (
                          <span className="ml-1.5 text-[10.5px] text-[#63636b]">
                            （已禁用）
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[11px] text-[#8a8a92]">
                        {server.transport === 'stdio'
                          ? server.command
                          : server.url}
                      </div>
                    </div>
                    <span
                      className="flex-none text-[11px]"
                      style={{ color: meta.fg }}
                    >
                      {meta.label}
                    </span>
                  </div>
                  {status.state === 'connected' ? (
                    <button
                      type="button"
                      data-testid="mcp-disconnect"
                      onClick={() => void disconnectMcp(server.id)}
                      className="self-start rounded-md bg-white/5 px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10"
                    >
                      断开
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="mcp-connect"
                      disabled={!server.enabled || status.state === 'connecting'}
                      onClick={() => void connectMcp(server.id)}
                      className="self-start rounded-md bg-white/5 px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10 disabled:opacity-40"
                    >
                      {status.state === 'error'
                        ? '重新连接'
                        : status.state === 'connecting'
                          ? '连接中…'
                          : '连接'}
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="mcp-edit"
                      onClick={() => startEditMcp(server)}
                      className="rounded-md px-2 py-1 text-[11px] text-[#b6b6be] hover:bg-white/10"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      data-testid="mcp-delete"
                      onClick={() => void removeMcp(server.id)}
                      className="rounded-md px-2 py-1 text-[11px] text-[#c9635b] hover:bg-white/10"
                    >
                      删除
                    </button>
                  </div>
                  {status.state === 'error' && status.error && (
                    <div
                      data-testid="mcp-error"
                      className="text-[11px] text-[#c9635b]"
                    >
                      {status.error}
                    </div>
                  )}
                  <McpToolsSection server={server} tools={tools} />
                </div>
              )
            })}
            {mcpServers.length === 0 && !editingMcpId && (
              <div className="rounded-[10px] bg-[#17171a] px-3 py-4 text-center text-[11.5px] text-[#63636b]">
                还没有 MCP 连接器。添加 stdio 或 http 服务后即可连接。
              </div>
            )}
          </div>

          {editingMcpId !== null && (
            <div className="mt-4 flex flex-col gap-2.5 rounded-[10px] bg-[#17171a] p-3">
              <div className="text-[12.5px] text-[#e4e4e9]">
                {mcpForm.id ? '编辑连接器' : '新连接器'}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">名称</span>
                <input
                  data-testid="mcp-name-input"
                  value={mcpForm.name}
                  onChange={(event) =>
                    setMcpForm({ ...mcpForm, name: event.target.value })
                  }
                  placeholder="postgres · prod-read"
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">
                  服务标识（工具名前缀，如 postgres）
                </span>
                <input
                  data-testid="mcp-key-input"
                  value={mcpForm.key}
                  onChange={(event) =>
                    setMcpForm({ ...mcpForm, key: event.target.value })
                  }
                  placeholder="postgres"
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">传输</span>
                <select
                  data-testid="mcp-transport-input"
                  value={mcpForm.transport}
                  onChange={(event) =>
                    setMcpForm({
                      ...mcpForm,
                      transport: event.target.value as 'stdio' | 'http',
                    })
                  }
                  className="rounded-md border border-white/5 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-white/15"
                >
                  <option value="stdio">stdio（本地进程）</option>
                  <option value="http">http（SSE）</option>
                </select>
              </label>
              {mcpForm.transport === 'stdio' ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[#6d6d75]">启动命令</span>
                    <input
                      data-testid="mcp-command-input"
                      value={mcpForm.command}
                      onChange={(event) =>
                        setMcpForm({ ...mcpForm, command: event.target.value })
                      }
                      placeholder="node scripts/mcp-fixture-server.mjs"
                      className="rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[#6d6d75]">参数（空格分隔，可选）</span>
                    <input
                      data-testid="mcp-args-input"
                      value={mcpForm.args}
                      onChange={(event) =>
                        setMcpForm({ ...mcpForm, args: event.target.value })
                      }
                      className="rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                    />
                  </label>
                </>
              ) : (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#6d6d75]">SSE URL</span>
                  <input
                    data-testid="mcp-url-input"
                    value={mcpForm.url}
                    onChange={(event) =>
                      setMcpForm({ ...mcpForm, url: event.target.value })
                    }
                    placeholder="https://mcp.example.com/sse"
                    className="rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6d6d75]">
                  环境变量（KEY=VALUE，每行一个；可用 secret:&lt;ref&gt; 引用密钥）
                </span>
                <textarea
                  data-testid="mcp-env-input"
                  value={mcpForm.env}
                  onChange={(event) =>
                    setMcpForm({ ...mcpForm, env: event.target.value })
                  }
                  rows={3}
                  className="resize-none rounded-md border border-white/5 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-white/15"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  data-testid="mcp-enabled-input"
                  type="checkbox"
                  checked={mcpForm.enabled}
                  onChange={(event) =>
                    setMcpForm({ ...mcpForm, enabled: event.target.checked })
                  }
                  className="h-3.5 w-3.5"
                />
                <span className="text-[11px] text-[#6d6d75]">启用该服务</span>
              </label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  data-testid="mcp-save"
                  disabled={busy}
                  onClick={() => void saveMcp()}
                  className="flex-1 rounded-md bg-sky-500/80 px-2 py-1.5 text-[12px] text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingMcpId(null)
                    setMcpForm(EMPTY_MCP_FORM)
                    setError(undefined)
                  }}
                  className="rounded-md bg-white/5 px-3 py-1.5 text-[12px] text-[#b6b6be] hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 权限徽标（只读展示）：内置分类默认值，不是可编辑控件 */
function PermissionBadge({ permission }: { permission: ToolPermission }) {
  const meta: Record<ToolPermission, { label: string; bg: string; fg: string }> = {
    allow: { label: '允许', bg: 'rgba(143,198,165,.14)', fg: '#8fc6a5' },
    ask: { label: '询问', bg: 'rgba(224,163,62,.14)', fg: '#e0c39e' },
    deny: { label: '禁止', bg: 'rgba(201,99,91,.14)', fg: '#e5a49d' },
  }
  const current = meta[permission]
  return (
    <span
      data-testid={`tool-perm-badge-${permission}`}
      className="flex-none rounded-md px-2 py-0.5 text-[10.5px]"
      style={{ background: current.bg, color: current.fg }}
    >
      {current.label}
    </span>
  )
}

const MCP_STATUS_META: Record<
  McpServerStatus['state'],
  { label: string; dot: string; fg: string }
> = {
  connected: { label: '已连接', dot: '#8fc6a5', fg: '#8fc6a5' },
  error: { label: '连接失败', dot: '#c9635b', fg: '#dfa39d' },
  off: { label: '未连接', dot: '#55555c', fg: '#8a8a92' },
  connecting: { label: '连接中…', dot: '#e0a33e', fg: '#e0c39e' },
}

function McpToolsSection({
  server,
  tools,
}: {
  server: McpServerConfig
  tools: ToolSettingView[]
}) {
  const [open, setOpen] = useState(false)
  const serverTools = tools.filter((tool) => tool.id.startsWith(`${server.key}.`))
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-testid="mcp-tools-toggle"
        onClick={() => setOpen((current) => !current)}
        className="self-start text-[11px] text-[#8a8a92] hover:text-[#b6b6be]"
      >
        {open ? '▾' : '▸'} {serverTools.length} 个工具
      </button>
      {open && (
        <div className="flex flex-col gap-1">
          {serverTools.map((tool) => (
            <div
              key={tool.id}
              data-testid="mcp-tool-row"
              className="flex items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#dcdce1]">
                {tool.id}
              </span>
              <PermissionBadge permission={tool.permission} />
            </div>
          ))}
          {serverTools.length === 0 && (
            <div className="text-[11px] text-[#63636b]">
              连接后自动发现工具
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function channelConfigured(
  editingId: string | undefined,
  channels: Channel[],
): boolean {
  const channel = channels.find((item) => item.id === editingId)
  return Boolean(channel?.secretRef)
}
