/**
 * Compatibility adapter：把现有 Main service/store 委托给 Runtime 门面。
 *
 * 删除期限：
 * - Session catalog 已在 K03 改为注入；legacy 消息委托在 K05 删除。
 * - orchestrator 已在 K08 退出生产 Run；permission、plan、question、compaction
 *   委托按 M1 后续 Slice 删除。
 * - 该文件不得成为第二个长期应用门面。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createRunCoordinator,
  createTgBuddyRuntime,
  type AgentEngine,
  type AgentInvocation,
  type SessionCommands,
  type SessionMessageHistory,
  type TgBuddyRuntime,
} from '../../runtime/index.ts'
import type { SendInput } from '../../shared/contracts/ipc.ts'
import type { PermissionMode } from '../../shared/contracts/permission.ts'
import * as askUser from '../ask-user-service.ts'
import {
  DATA_DIR,
  ensureDataDir,
  listChannels,
  saveChannels,
} from '../channel-store.ts'
import * as compaction from '../compaction-service.ts'
import * as permission from '../permission-service.ts'
import * as plan from '../plan-service.ts'

export interface CreateLegacyRuntimeOptions {
  sessions: SessionCommands
  history: SessionMessageHistory
  agentEngine: AgentEngine
  dispose?(): Promise<void>
}

export function createLegacyRuntime(
  options: CreateLegacyRuntimeOptions,
): TgBuddyRuntime {
  ensureDataDir()
  const runs = createRunCoordinator({
    now: Date.now,
    engine: options.agentEngine,
    createInvocation: (input) => createAgentInvocation(input, options.sessions),
  })

  return createTgBuddyRuntime({
    workspaces: {
      list: () => [],
    },
    sessions: options.sessions,
    runs,
    permissions: {
      respond: permission.respond,
      pending: permission.getPending,
      expireSessionRules: permission.expireSessionRules,
    },
    plans: {
      respond: plan.respond,
      pending: plan.getPending,
      setMode: permission.setMode,
    },
    questions: {
      respond: askUser.respond,
      pending: askUser.getPending,
    },
    context: {
      start: (sessionId, emit, isRunning) =>
        compaction.start(sessionId, emit, options.history, isRunning),
      defer: compaction.defer,
      cancel: compaction.cancel,
      clearSession: compaction.clearSession,
    },
    artifacts: {
      list: () => [],
    },
    capabilities: {
      list: () => [],
    },
    settings: {
      listChannels,
      saveChannel(channel) {
        const channels = listChannels().filter((item) => item.id !== channel.id)
        saveChannels([...channels, channel])
      },
      deleteChannel(channelId) {
        saveChannels(listChannels().filter((item) => item.id !== channelId))
      },
      async testChannel(_channelId) {
        return { success: false, message: '未实现' }
      },
    },
    async dispose() {
      await runs.dispose()
      await options.dispose?.()
    },
  })
}

async function createAgentInvocation(
  input: SendInput,
  sessions: SessionCommands,
): Promise<AgentInvocation> {
  const meta = sessions.list().find((session) => session.id === input.sessionId)
  if (!meta) throw new Error(`会话不存在：${input.sessionId}`)

  const channels = listChannels()
  if (channels.length === 0) {
    throw new Error(
      '还没有配置任何渠道。请先在设置中配置模型渠道',
    )
  }
  const channel = channels.find((item) => item.id === meta.channelId)
    ?? channels[0]
  if (!channel) throw new Error('没有可用渠道')

  const modelId = meta.modelId ?? channel.models[0]?.id
  if (!modelId) throw new Error(`渠道「${channel.name}」下没有可用模型`)
  if (!channel.models.some((model) => model.id === modelId)) {
    throw new Error(`模型未注册：${channel.id}/${modelId}`)
  }

  const mode = meta.permissionMode ?? 'auto'
  permission.setMode(input.sessionId, mode)
  const workspaceDir = resolveWorkspace(meta.workspaceId)

  return {
    sessionId: input.sessionId,
    text: input.text,
    channel,
    modelId,
    systemPrompt: buildSystemPrompt(workspaceDir, mode),
  }
}

function buildSystemPrompt(
  workspaceDir: string,
  mode: PermissionMode,
): string {
  return [
    '你是 TgBuddy 的 Agent 助手。回答简洁准确，中文优先。',
    '',
    '## 工作区',
    `当前工作目录：${workspaceDir}`,
    ...(mode === 'plan'
      ? [
          '',
          '## 计划模式',
          '当前只分析问题并给出实施计划，不执行会改变工作区的操作。',
        ]
      : []),
  ].join('\n')
}

function resolveWorkspace(workspaceId?: string): string {
  const directory = join(
    DATA_DIR,
    'workspaces',
    workspaceId ?? 'default',
  )
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  return directory
}
