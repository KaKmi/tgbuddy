/**
 * 会话编排 —— 主进程的核心。
 *
 * 职责：并发守卫、构建 Agent、订阅事件、转发到渲染进程、落盘。
 *
 * 阶段 2 只做到"能发消息看到流式文字"。以下留给后续阶段：
 *   - 权限拦截（阶段 4）：在 `beforeToolCall` 里挂起等 UI
 *   - 工具集（阶段 4）
 *   - 重试（见 docs/01 6.6）
 *   - 上下文压缩（阶段 6）
 *   - 专家绑定（阶段 7.5）
 */

import { Agent } from '@earendil-works/pi-agent-core'
import type { SendInput } from '../shared/ipc.ts'
import type { StreamFrame, StreamPayload } from '../shared/types/event.ts'
import { toKernelMessages } from '../shared/types/message.ts'
import { buildModels } from '../kernel/models.ts'
import { eventFromPi } from '../kernel/normalize.ts'
import { buildContextUsage } from '../kernel/context-usage.ts'
import { DATA_DIR, listChannels } from './channel-store.ts'
import * as permission from './permission-service.ts'
import * as store from './session-store.ts'
import * as plan from './plan-service.ts'
import * as askUser from './ask-user-service.ts'
import { buildBuiltinTools } from './tools/index.ts'
import { buildAskUserTool } from './tools/ask-user.ts'
import { buildPlanModeTools } from './tools/plan-mode.ts'
import { configureSandbox } from './tools/sandbox.ts'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type FrameSender = (frame: StreamFrame) => void

/**
 * 并发守卫：sessionId → runId。
 *
 * generation 令牌处理三个常见的异步竞态：
 *   ① 抢占槽位必须在第一个 await 之前，否则并发调用会在 await 间隙绕过入口检查
 *   ② 释放时要校验 runId，防止旧流的 finally 误删新流的注册
 *   ③ 用户主动停止用单独的 Set 标记 —— 不能只靠 catch，
 *      因为中断后内核不一定走异常路径
 */
const activeRuns = new Map<string, number>()
const runningAgents = new Map<string, Agent>()
const stoppedByUser = new Set<string>()
let runSequence = 0

export function isRunning(sessionId: string): boolean {
  return activeRuns.has(sessionId)
}

export async function send(input: SendInput, sendFrame: FrameSender): Promise<void> {
  const { sessionId } = input

  // ── ① 入口检查 + 抢占槽位（第一个 await 之前）──────────────────
  if (activeRuns.has(sessionId)) {
    emitHostError(sessionId, 0, '上一条消息仍在处理中，请稍候', sendFrame)
    return
  }
  // 严格递增，避免 Date.now() 在同一毫秒内重复导致旧流无法识别。
  const runId = ++runSequence
  activeRuns.set(sessionId, runId)

  const releaseRun = (): void => {
    if (activeRuns.get(sessionId) !== runId) return // ② runId 不匹配就不清
    activeRuns.delete(sessionId)
    runningAgents.delete(sessionId)
    stoppedByUser.delete(sessionId)
  }

  const emit = (payload: StreamPayload): void => sendFrame({ sessionId, runId, payload })

  try {
    const meta = store.getSession(sessionId)
    if (!meta) throw new Error(`会话不存在：${sessionId}`)

    // ── ② 解析渠道与模型 ────────────────────────────────────────
    const channels = listChannels()
    if (channels.length === 0) {
      throw new Error('还没有配置任何渠道。请在 ~/.tgbuddy/channels.json 里配置，或设置 DEEPSEEK_API_KEY 环境变量')
    }
    const channel = channels.find((c) => c.id === meta.channelId) ?? channels[0]!
    const modelId = meta.modelId ?? channel.models[0]?.id
    if (!modelId) throw new Error(`渠道「${channel.name}」下没有可用模型`)

    const models = buildModels(channels)
    const model = models.getModel(channel.id, modelId)
    if (!model) throw new Error(`模型未注册：${channel.id}/${modelId}`)

    // ── ③ 工作区与沙箱 ─────────────────────────────────────────
    // ⚠️ **绝不能把 cwd 设成项目源码目录** —— 那等于让 Agent 能改自己的代码。
    //    默认给一个独立的工作区目录，沙箱的白名单也锁死在这里。
    const workspaceDir = resolveWorkspace(meta.workspaceId)
    configureSandbox({ allowedRoots: [workspaceDir] })

    // 权限模式跟着会话走。重启后从 meta 恢复，否则每次都退回 auto
    permission.setMode(sessionId, meta.permissionMode ?? 'auto')

    // ── ④ 构建 Agent ───────────────────────────────────────────
    // 每次 run 新建一个实例，历史从 store 载入。
    // 状态在我们手里，Agent 只是个无状态的执行器——这正是 pi 的心智模型。
    const agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPrompt(workspaceDir, meta.permissionMode ?? 'auto'),
        model,
        tools: [
          ...buildBuiltinTools(workspaceDir),
          buildAskUserTool({
            requestAnswers: (questions, signal) =>
              askUser.requestAnswers(
                sessionId,
                questions,
                (request) => emit({ channel: 'host', event: { type: 'ask_user_request', request } }),
                signal,
              ),
          }),
          ...buildPlanModeTools({
            getMode: () => permission.getMode(sessionId),
            setMode: (mode) => {
              permission.setMode(sessionId, mode)
              store.updateMeta(sessionId, { permissionMode: mode })
            },
            onModeChanged: (mode, source) =>
              emit({ channel: 'host', event: { type: 'mode_changed', mode, source } }),
            requestApproval: (planText, signal) =>
              plan.requestApproval(sessionId, planText, (request) =>
                emit({ channel: 'host', event: { type: 'plan_request', request } }),
              signal),
          }),
        ],
        messages: toKernelMessages(store.getMessages(sessionId)),
      },
      streamFn: models.streamSimple.bind(models),
      // 不依赖 process.env —— GUI 启动的 Electron 读不到 shell 环境变量
      getApiKey: async () => channel.apiKey,
      // ★ 权限拦截点。这个钩子是 await 的，所以能真的挂起 agent loop
      //   等一次 IPC 往返到渲染进程弹窗（阶段 1 实测确认过）
      beforeToolCall: permission.createBeforeToolCall(sessionId, (request) => {
        emit({ channel: 'host', event: { type: 'permission_request', request } })
      }),
    })
    runningAgents.set(sessionId, agent)

    // ── ④ 订阅事件 ─────────────────────────────────────────────
    // ⚠️ pi 的监听器是被 await 的、按订阅顺序串行执行。
    //    你的监听器慢 = agent 慢。所以这里只做转发和落盘，绝不等渲染完成。
    agent.subscribe((e) => {
      const event = eventFromPi(e, store.newId)
      if (!event) return

      if (event.type === 'message_end') {
        store.appendMessage(sessionId, event.message)
      }

      // 侧边栏那行「正在写 xxx…」的数据来源。
      // TODO(阶段 4): tool_start 时用工具名+参数生成更具体的摘要，
      //   比如 write → 「正在写 reports/q2-risk.md」
      if (event.type === 'tool_start') {
        store.updateMeta(sessionId, { lastActivity: `正在执行 ${event.toolName}…` })
      }

      if (event.type === 'turn_end' && event.usage) {
        const contextUsage = buildContextUsage({
          messages: agent.state.messages,
          systemPrompt: agent.state.systemPrompt,
          tools: agent.state.tools,
          contextWindow: model.contextWindow,
          usage: event.usage,
        })
        store.updateMeta(sessionId, { contextUsage })
        emit({ channel: 'host', event: { type: 'context_usage', usage: contextUsage } })
      }

      emit({ channel: 'agent', event })
    })

    // ── ⑤ 跑 ───────────────────────────────────────────────────
    store.updateMeta(sessionId, { status: 'running', lastActivity: '正在思考…' })
    await agent.prompt(input.text)
    store.updateMeta(sessionId, {
      status: stoppedByUser.has(sessionId) ? 'idle' : 'done',
      lastActivity: undefined,
      // 从落盘消息重算，不维护增量计数器 —— 重启和截断历史后都自然正确
      artifactCount: store.countArtifacts(sessionId),
    })
  } catch (err) {
    // 用户主动停止不算错误
    if (!stoppedByUser.has(sessionId)) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[orchestrator] run 失败：', err)
      store.updateMeta(sessionId, { status: 'failed', statusDetail: shortReason(message) })
      emit({ channel: 'host', event: { type: 'host_error', message, recoverable: false } })
    } else {
      store.updateMeta(sessionId, { status: 'idle', lastActivity: undefined })
    }
  } finally {
    // ★ 逃生口 2：会话结束时批量拒绝挂起的授权请求。
    //   不做这个，用户关掉窗口后 agent loop 会永远挂在一个等不到答复的 Promise 上
    permission.clearSession(sessionId)
    plan.clearSession(sessionId)
    askUser.clearSession(sessionId)
    emit({ channel: 'host', event: { type: 'pending_requests_cleared' } })
    releaseRun() // ③ 兜底释放
  }
}

export function stop(sessionId: string): void {
  stoppedByUser.add(sessionId)
  runningAgents.get(sessionId)?.abort()
  // 槽位由 send() 的 finally 释放，这里不直接删，
  // 否则和 releaseRun 的 runId 校验会打架
}

// ── 辅助 ──────────────────────────────────────────────────────────

function emitHostError(
  sessionId: string,
  runId: number,
  message: string,
  sendFrame: FrameSender,
): void {
  sendFrame({
    sessionId,
    runId,
    payload: { channel: 'host', event: { type: 'host_error', message, recoverable: true } },
  })
}

/**
 * 把冗长的错误压成侧边栏能放下的一句。
 * 完整错误仍然通过 host_error 事件送到 UI，这里只是列表上的摘要。
 */
function shortReason(message: string): string {
  const first = message.split('\n')[0] ?? message
  if (/401|authentication/i.test(first)) return '认证失败'
  if (/429|rate.?limit/i.test(first)) return '限流'
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(first)) return '网络超时'
  if (/渠道|模型未注册/.test(first)) return '渠道配置有误'
  return first.length > 24 ? `${first.slice(0, 24)}…` : first
}

/**
 * TODO(阶段 4+): 挪到 prompt-builder.ts，按 docs/01 6.4 的静态/动态二分组织：
 *   - 静态部分吃 prompt caching，会话期间不变
 *   - 动态部分每条消息实时读盘（当前时间、工作目录、专家绑定的技能列表）
 */
function buildSystemPrompt(workspaceDir: string, mode: 'plan' | 'auto' | 'bypass'): string {
  return [
    '你是 TgBuddy 的 Agent 助手。回答简洁准确，中文优先。',
    '',
    '## 工作区',
    `所有文件操作都在这个目录下进行：${workspaceDir}`,
    '路径可以用相对路径，超出这个范围的操作会被沙箱拒绝。',
    '',
    '## 工具使用',
    '- 改文件前先 read 确认现状，不要凭猜测 write 覆盖',
    '- edit 的 old_text 必须唯一，找不到或有多处时请提供更长的上下文',
    '- 写操作和命令需要用户授权，被拒绝时换一种方式，不要重复请求同一个操作',
    '- 缺少会显著影响方案或结果的信息时，必须调用 ask_user；不要只输出问题后结束任务',
    ...(mode === 'plan'
      ? [
          '',
          '## 计划模式',
          '- 当前已经处于计划模式，不要再次调用 enter_plan_mode',
          '- 先用只读工具调研；需要用户补充信息时调用 ask_user',
          '- 计划完整后调用 exit_plan_mode 提交审批，不要直接执行写操作',
        ]
      : []),
  ].join('\n')
}

/**
 * 会话的工作目录。
 *
 * TODO(阶段 7.5): 接上真正的工作区管理（切换器、每个工作区独立路径）。
 *   现在所有会话共用一个默认工作区。
 */
function resolveWorkspace(workspaceId?: string): string {
  const dir = join(DATA_DIR, 'workspaces', workspaceId ?? 'default')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
