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

import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { buildModels } from '../src/kernel/models.ts'
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
const models = buildModels([channel])
const model = models.getModel(channel.id, MODEL_ID)
if (!model) {
  console.error(`模型未注册：${channel.id}/${MODEL_ID}`)
  console.error(`可用：${channel.models.map((m) => m.id).join(', ')}`)
  process.exit(1)
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

// ── 构建 Agent ────────────────────────────────────────────────────
const agent = new Agent({
  initialState: {
    systemPrompt: '你是一个测试助手。回答简短。需要时间信息时调用工具。',
    model,
    tools: [getTimeTool],
  },
  // 0.81.0 起 streamFn 从可选变必填。我们本来就要传自建的 models，零成本。
  streamFn: models.streamSimple.bind(models),

  // 每次请求带上 key —— 不依赖 process.env，因为 GUI 启动的 Electron 读不到 shell 环境变量
  onPayload: undefined,
  getApiKey: async () => API_KEY,

  /**
   * ★ 权限拦截点验证
   *
   * 这里故意 await 一个 800ms 的延迟，模拟「IPC 往返到渲染进程弹窗、等用户点击」。
   * 如果 agent loop 真的挂起等待，说明
   * `Map<requestId, resolve>` 跨 IPC 挂起 Promise 的模式可以成立。
   */
  beforeToolCall: async ({ toolCall, args }, signal) => {
    console.log(`\n  [权限] 请求执行工具：${toolCall.name}`)
    console.log(`  [权限] 参数：${JSON.stringify(args)}`)
    const t0 = Date.now()

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 800)
      // pi 把 signal 给你，但**你有责任自己 honor abort**。
      // 不加这段，用户点停止时这个 Promise 会挂死。
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })

    console.log(`  [权限] 用户已确认（模拟等待 ${Date.now() - t0}ms）→ 放行\n`)
    return undefined // undefined = 放行；{ block: true, reason } = 拒绝
  },
})

// ── 订阅事件 ──────────────────────────────────────────────────────
// 注意：监听器是被 await 的、按订阅顺序串行执行。
// 你的监听器慢 = agent 慢。往渲染进程发 IPC 时不要 await 渲染完成。
let sawError = false

agent.subscribe((event) => {
  switch (event.type) {
    case 'message_update': {
      const e = event.assistantMessageEvent
      if (e.type === 'text_delta') process.stdout.write(e.delta)
      if (e.type === 'thinking_delta') process.stdout.write(`\x1b[90m${e.delta}\x1b[0m`)
      // ★ pi 的契约：stream 永远不 throw，失败编码成 error 事件。
      //   不处理这个分支，认证失败/端点不通会被静默吞掉，看起来像"跑通了"。
      if (e.type === 'error') {
        sawError = true
        console.error(`\n\x1b[31m  [错误] ${e.reason}：${e.error.errorMessage ?? '(无消息)'}\x1b[0m`)
      }
      break
    }
    case 'tool_execution_start':
      console.log(`\n  [工具] 开始执行 ${event.toolName}`)
      break
    case 'tool_execution_end':
      console.log(`  [工具] 完成，isError=${event.isError}`)
      break
    case 'turn_end': {
      if (event.message.role === 'assistant' && event.message.stopReason === 'error') {
        sawError = true
        console.error(`\n\x1b[31m  [错误] ${event.message.errorMessage ?? '(无消息)'}\x1b[0m`)
      }
      const u = event.message.role === 'assistant' ? event.message.usage : undefined
      if (u) {
        console.log(
          `\n  [用量] in=${u.input} out=${u.output} ` +
          `cacheRead=${u.cacheRead} 共 ${u.totalTokens} tokens，` +
          `成本 $${u.cost.total.toFixed(6)}`,
        )
      }
      break
    }
  }
})

// ── 跑 ────────────────────────────────────────────────────────────
console.log(`\n端点：${channel.baseUrl}`)
console.log(`模型：${MODEL_ID}（${channel.protocol} 协议）\n`)
console.log('─'.repeat(60))
console.log('\n【第 1 轮】纯文本，验证流式输出\n')
await agent.prompt('用一句话介绍你自己。')

console.log('\n\n' + '─'.repeat(60))
console.log('\n【第 2 轮】触发工具调用，验证 beforeToolCall 挂起\n')
await agent.prompt('现在几点了？')

console.log('\n\n' + '─'.repeat(60))
console.log('\n【第 3 轮】验证多轮上下文（消息数组就是全部状态）\n')
await agent.prompt('我刚才问你的第一个问题是什么？')

console.log('\n\n' + '─'.repeat(60))

if (sawError) {
  console.error('\n\x1b[31m✗ 有请求失败了。常见原因：\x1b[0m')
  console.error('  · API Key 无效或额度不足')
  console.error('  · 模型 id 不对（0.82.1 的目录里只有 deepseek-v4-flash / deepseek-v4-pro）')
  console.error('  · 走中转网关时 baseUrl 不对，或该网关需要额外的 compat 配置')
  console.error('    → 参考 node_modules/@earendil-works/pi-ai/dist/providers/data/*.json\n')
  process.exit(1)
}

console.log(`\n✓ 会话消息数：${agent.state.messages.length}`)
console.log('✓ 这个数组就是全部状态 —— JSON.stringify 存盘，赋值回去就能续接')
console.log('  （会话状态由宿主维护，可直接检查和持久化）\n')
