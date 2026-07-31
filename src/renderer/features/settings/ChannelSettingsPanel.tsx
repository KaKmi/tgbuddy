import { useEffect, useState } from 'react'
import type {
  Channel,
  ChannelModel,
  ChannelProtocol,
  ChannelSaveInput,
  ChannelTestResult,
} from '../../../shared/contracts/channel.ts'
import type { Profile, ProfileSaveInput } from '../../../shared/contracts/profile.ts'

export interface ChannelSettingsPanelProps {
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

/**
 * 设置页「模型与密钥」的最小 feature（C02）：渠道 CRUD。
 * 密钥输入只在本组件内存里存在，保存后主进程写入 SecretStore；
 * 列表结果只显示「已配置/未配置」状态，不回传明文。
 */
export function ChannelSettingsPanel(props: ChannelSettingsPanelProps) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
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
    const [channelList, profileList] = await Promise.all([
      window.tgbuddy.channel.list(),
      window.tgbuddy.profile.list(),
    ])
    setChannels(channelList)
    setProfiles(profileList)
  }

  useEffect(() => {
    void refresh()
  }, [])

  function startEdit(channel?: Channel) {
    setEditingId(channel?.id ?? null)
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
    setEditingProfileId(profile?.id ?? null)
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
                  <span
                    className="h-[7px] w-[7px] flex-none rounded-full"
                    style={{ background: channel.secretRef ? '#8fc6a5' : '#55555c' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-[#e4e4e9]">{channel.name}</div>
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
        </div>
      </div>
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
