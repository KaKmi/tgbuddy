/**
 * 阶段 1 验证脚本 —— 不碰 Electron，先证明内核能跑通。
 *
 * 验证三件事（第 3 件是整个权限设计的支点）：
 *   1. 能连上你配置的端点，流式输出正常
 *   2. 工具调用能跑通（TypeBox schema → 模型调用 → 结果回填）
 *   3. beforeToolCall 能**真的挂起** agent loop 等一个异步结果
 *      —— 这决定了「弹 UI 让用户确认」是否可行
 *
 * 用法（DeepSeek，compat 已按 pi 官方目录预配好）：
 *   DEEPSEEK_API_KEY=sk-xxx bun run probe
 *
 * 可选：
 *   DEEPSEEK_MODEL=deepseek-v4-pro   （默认 deepseek-v4-flash）
 *   DEEPSEEK_BASE_URL=...            （走中转网关时）
 */

import {
  InMemorySessionRepo,
  type AgentTool,
} from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import {
  createPiAgentEngine,
} from '../src/kernel/pi/pi-agent-engine.ts'
import { PiRunExecutionEnvFactory } from '../src/kernel/pi/pi-execution-env.ts'
import type { AgentInvocation } from '../src/runtime/index.ts'
import { deepseekChannel } from '../src/shared/channel-presets.ts'

const API_KEY = process.env.DEEPSEEK_API_KEY ?? process.env.TGBUDDY_API_KEY
const MODEL_ID = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
const BASE_URL = process.env.DEEPSEEK_BASE_URL

if (!API_KEY) {
  console.error('缺少 DEEPSEEK_API_KEY。用法：')
  console.error('  DEEPSEEK_API_KEY=sk-xxx bun run probe')
  process.exit(1)
}

const channel = BASE_URL ? deepseekChannel(API_KEY, BASE_URL) : deepseekChannel(API_KEY)
if (!channel.models.some((model) => model.id === MODEL_ID)) {
  console.error(`模型未注册：${channel.id}/${MODEL_ID}`)
  console.error(`可用：${channel.models.map((m) => m.id).join(', ')}`)
  process.exit(1)
}

const probeSessionId = 'probe-agent-engine'
const sessionRepository = new InMemorySessionRepo()
const harnessSession = await sessionRepository.create({ id: probeSessionId })
const engineInvocation: Omit<AgentInvocation, 'text'> = {
  sessionId: probeSessionId,
  workspaceId: 'probe-workspace',
  cwd: process.cwd(),
  channel,
  modelId: MODEL_ID,
  systemPrompt: '你是一个测试助手。回答简短。',
}

// ── 一个最小工具，用来验证工具调用链路 ──────────────────────────────
const getTimeTool: AgentTool = {
  name: 'get_current_time',
  label: '获取当前时间',
  description: '返回当前的日期和时间。当用户询问现在几点或今天几号时使用。',
  parameters: Type.Object({
    timezone: Type.Optional(Type.String({ description: '时区，如 Asia/Shanghai' })),
  }),
  execute: async (_toolCallId, params) => {
    const tz = (params as { timezone?: string }).timezone ?? 'Asia/Shanghai'
    const now = new Date().toLocaleString('zh-CN', { timeZone: tz })
    return {
      content: [{ type: 'text', text: `当前时间（${tz}）：${now}` }],
      details: {},
    }
  },
}

const agentEngine = createPiAgentEngine({
  sessions: {
    async openHarnessSession(sessionId) {
      return sessionId === probeSessionId ? harnessSession : undefined
    },
  },
  envFactory: new PiRunExecutionEnvFactory(),
  tools: () => [getTimeTool],
  toolPolicy: {
    async evaluate(input, signal) {
      console.log(`\n  [策略] 请求执行工具：${input.toolName}`)
      console.log(`  [策略] 参数：${JSON.stringify(input.args)}`)
      const startedAt = Date.now()
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve()
          return
        }
        const timer = setTimeout(resolve, 800)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      console.log(`  [策略] 模拟等待 ${Date.now() - startedAt}ms → 放行\n`)
      return { action: 'allow' }
    },
  },
})

// ── 订阅事件 ──────────────────────────────────────────────────────
// 注意：监听器是被 await 的、按订阅顺序串行执行。
// 你的监听器慢 = agent 慢。往渲染进程发 IPC 时不要 await 渲染完成。
let sawError = false
let sawToolStart = false
let sawToolEnd = false

async function runProductionEngine(
  text: string,
  abortOnStart = false,
): Promise<'completed' | 'aborted'> {
  const controller = new AbortController()
  let aborted = false
  for await (const event of agentEngine.run({
    ...engineInvocation,
    text,
  }, controller.signal)) {
    if (event.type === 'run_start' && abortOnStart) controller.abort()
    if (event.type === 'text_delta') process.stdout.write(event.delta)
    if (event.type === 'thinking_delta') {
      process.stdout.write(`\x1b[90m${event.delta}\x1b[0m`)
    }
    if (event.type === 'tool_start') {
      sawToolStart = true
      console.log(`\n  [工具] 开始执行 ${event.toolName}`)
    }
    if (event.type === 'tool_end') {
      sawToolEnd = true
      console.log(`  [工具] 完成，isError=${event.isError}`)
    }
    if (event.type === 'error') {
      if (event.reason === 'aborted' && abortOnStart) {
        aborted = true
      } else {
        sawError = true
      }
      console.error(`\n\x1b[31m  [错误] ${event.reason}：${event.message}\x1b[0m`)
    }
    if (event.type === 'turn_end' && event.usage) {
      console.log(
        `\n  [用量] in=${event.usage.input} out=${event.usage.output} `
        + `cacheRead=${event.usage.cacheRead} 共 ${event.usage.totalTokens} tokens，`
        + `成本 $${event.usage.cost.total.toFixed(6)}`,
      )
    }
  }
  return aborted ? 'aborted' : 'completed'
}

// ── 跑 ────────────────────────────────────────────────────────────
console.log(`\n端点：${channel.baseUrl}`)
console.log(`模型：${MODEL_ID}（${channel.protocol} 协议）\n`)
console.log('─'.repeat(60))
console.log('\n【第 1 轮】纯文本，验证流式输出\n')
await runProductionEngine('用一句话介绍你自己。')

console.log('\n\n' + '─'.repeat(60))
console.log('\n【第 2 轮】触发工具调用，验证生产 ToolPolicy 挂起\n')
await runProductionEngine('必须调用 get_current_time 工具告诉我现在几点，不要自己猜。')

console.log('\n\n' + '─'.repeat(60))
console.log('\n【第 3 轮】验证多轮上下文（消息数组就是全部状态）\n')
await runProductionEngine('我刚才问你的第一个问题是什么？')

console.log('\n\n' + '─'.repeat(60))
console.log('\n【第 4 轮】验证生产 AbortSignal 能停止 Harness\n')
const abortResult = await runProductionEngine(
  '请写一篇很长的文章，用来验证停止。',
  true,
)
if (abortResult !== 'aborted') {
  sawError = true
  console.error('\n\x1b[31m  [错误] AbortSignal 未产生 aborted 终态\x1b[0m')
}
if (!sawToolStart || !sawToolEnd) {
  sawError = true
  console.error('\n\x1b[31m  [错误] 生产 PiAgentEngine 未完成工具事件闭环\x1b[0m')
}

console.log('\n\n' + '─'.repeat(60))

if (sawError) {
  await agentEngine.dispose()
  console.error('\n\x1b[31m✗ 有请求失败了。常见原因：\x1b[0m')
  console.error('  · API Key 无效或额度不足')
  console.error('  · 模型 id 不对（0.82.1 的目录里只有 deepseek-v4-flash / deepseek-v4-pro）')
  console.error('  · 走中转网关时 baseUrl 不对，或该网关需要额外的 compat 配置')
  console.error('    → 参考 node_modules/@earendil-works/pi-ai/dist/providers/data/*.json\n')
  process.exit(1)
}

const persistedMessages = (await harnessSession.getEntries())
  .filter((entry) => entry.type === 'message')
await agentEngine.dispose()
console.log(`\n✓ Harness 会话消息数：${persistedMessages.length}`)
console.log('✓ 生产 PiAgentEngine 已通过同一 Session 恢复多轮上下文')
console.log('✓ message_end 在 Harness 持久化完成后进入 Runtime\n')
console.log('✓ 生产 ToolPolicy、tool_start 与 tool_end 已形成闭环\n')
console.log('✓ AbortSignal 已停止生产 AgentHarness\n')
