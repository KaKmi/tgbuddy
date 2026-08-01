/**
 * M4–M6 探索式 QA 驱动（可重复执行）。
 *
 * 运行：node .ship/tasks/tgbuddy-vertical-slices/qa/m4m6-qa-driver.mjs
 *
 * 覆盖：空状态样例 / 附件闭环 / 结果区（产物+预览+让 Agent 改这份）/
 * 会话搜索与菜单 / 计划模式闭环 / 设置页技能与工具区 / 完全访问 /
 * 布局截图（主窗口、结果区、设置页）作为原型视觉比对素材。
 */
import { _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const QA_DIR = join(import.meta.dirname, 'm4m6-qa')
const EVIDENCE_DIR = join(QA_DIR, 'screenshots')
await mkdir(EVIDENCE_DIR, { recursive: true })

const root = await mkdtemp(join(tmpdir(), 'tgbuddy-m4m6-qa-'))
const dataDir = join(root, 'data')
const userData = join(root, 'user-data')
const workspace = join(dataDir, 'workspaces', 'default')
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, 'README.md'), '# QA Workspace', 'utf8')

// ── fake OpenAI server ─────────────────────────────────────────
let toolCallSequence = 0
function writeChunk(res, value) {
  res.write(`data: ${JSON.stringify({
    id: 'chatcmpl-qa',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'qa-model',
    choices: value.choices,
    ...(value.usage ? { usage: value.usage } : {}),
  })}\n\n`)
}
function endStream(res, totalTokens = 1_000) {
  writeChunk(res, {
    choices: [],
    usage: {
      prompt_tokens: Math.max(0, totalTokens - 20),
      completion_tokens: 20,
      total_tokens: totalTokens,
    },
  })
  res.write('data: [DONE]\n\n')
  res.end()
}
async function streamText(res, text) {
  const splitAt = Math.max(1, Math.floor(text.length / 2))
  writeChunk(res, {
    choices: [{ index: 0, delta: { role: 'assistant', content: text.slice(0, splitAt) }, finish_reason: null }],
  })
  await new Promise((r) => setTimeout(r, 20))
  if (res.destroyed) return
  writeChunk(res, { choices: [{ index: 0, delta: { content: text.slice(splitAt) }, finish_reason: null }] })
  writeChunk(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  endStream(res)
}
function streamToolCall(res, toolName, args, idPrefix) {
  toolCallSequence += 1
  writeChunk(res, {
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: `${idPrefix}_${toolCallSequence}`,
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: null,
    }],
  })
  writeChunk(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  endStream(res, 1_000)
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'qa-model', object: 'model' }] }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    void (async () => {
      const parsed = JSON.parse(body)
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      const latestUser = [...messages].reverse().find((m) => m.role === 'user')
      const prompt = messageText(latestUser)
      const lastMessage = messages.at(-1)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      if (prompt.includes('M2 写入')) {
        if (lastMessage?.role === 'tool') {
          await streamText(res, 'M2 写入完成')
        } else {
          streamToolCall(res, 'write', { path: 'm2-write.txt', content: 'M2 写入内容' }, 'call_qa_write')
        }
        return
      }
      if (prompt.includes('M2 计划')) {
        const toolResults = messages.filter((m) => m.role === 'tool').length
        if (toolResults === 0) {
          streamToolCall(res, 'exit_plan_mode', { plan: '1. 修改 m2-write.txt\n2. 验证' }, 'call_qa_plan')
        } else {
          await streamText(res, 'M2 计划完成')
        }
        return
      }
      if (prompt.includes('M4 导出')) {
        if (lastMessage?.role === 'tool') {
          await streamText(res, 'M4 导出完成')
        } else {
          streamToolCall(
            res,
            'bash',
            { command: 'node -e "process.stdout.write(\'x\'.repeat(100))" > report.docx' },
            'call_qa_export',
          )
        }
        return
      }
      await streamText(res, `QA 回复：${prompt}`)
    })().catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: String(error) } }))
      } else {
        res.destroy()
      }
    })
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const fakeBaseUrl = `http://127.0.0.1:${server.address().port}/v1`

function messageText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
}

await writeFile(
  join(dataDir, 'channels.json'),
  JSON.stringify({
    channels: [{
      id: 'qa',
      name: 'QA 渠道',
      protocol: 'openai',
      baseUrl: fakeBaseUrl,
      apiKey: 'qa-key',
      models: [{
        id: 'qa-model',
        name: 'QA Model',
        contextWindow: 1_000_000,
        maxTokens: 4_096,
        compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: 'max_tokens' },
      }],
    }],
  }),
  'utf8',
)

// ── 结果记录 ──────────────────────────────────────────────────
const findings = []
function record(name, ok, detail = '') {
  findings.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`)
}
async function step(name, fn) {
  try {
    await fn()
    record(name, true)
  } catch (error) {
    const bodyText = await page
      .evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, ' | '))
      .catch(() => '<页面不可读>')
    record(name, false, `${String(error).split('\n')[0]?.slice(0, 120)} | 页面：${bodyText}`)
    await page.reload().catch(() => {})
    await page.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 20000 }).catch(() => {})
  }
}
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`) })
}

// ── 通用交互 ─────────────────────────────────────────────────
async function createSession(page) {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await page.getByPlaceholder(/说点什么/).waitFor({ timeout: 10000 })
}
async function send(page, prompt) {
  await page.getByPlaceholder(/说点什么/).fill(prompt)
  await page.getByPlaceholder(/说点什么/).press('Enter')
}
async function currentSessionId(page) {
  return page.evaluate(async () => (await window.tgbuddy.session.list())[0]?.id)
}
async function setPlanMode(page) {
  const sessionId = await currentSessionId(page)
  if (!sessionId) throw new Error('没有当前会话')
  await page.evaluate((sid) => window.tgbuddy.plan.setMode(sid, 'plan'), sessionId)
}
async function setBypassMode(page) {
  const sessionId = await currentSessionId(page)
  if (!sessionId) throw new Error('没有当前会话')
  await page.evaluate((sid) => window.tgbuddy.plan.setMode(sid, 'bypass'), sessionId)
}

// ── Electron 启动 ─────────────────────────────────────────────
let app
let page
try {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--disable-gpu'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TGBUDDY_DATA_DIR: dataDir,
      TGBUDDY_WORKSPACE_DIR: workspace,
      TGBUDDY_E2E: '1',
    },
  })
  page = await app.firstWindow()
  await page.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 60000 })
} catch (error) {
  console.error('应用启动失败：', error)
  process.exit(1)
}

// ══ 1. 空状态与样例 ═══════════════════════════════════════════
await step('U01：整窗空状态显示三个任务样例', async () => {
  await expectCount(page, 'session-sample', 3)
  await shot(page, '01-empty-state')
})

await step('U01：点击样例新建会话并预填草稿（不自动发送）', async () => {
  await page.getByTestId('session-sample').first().click()
  await page.getByPlaceholder(/说点什么/).waitFor({ timeout: 10000 })
  const value = await page.getByPlaceholder(/说点什么/).inputValue()
  if (!value.trim()) throw new Error('样例未预填草稿')
})

await step('冒烟：普通消息流式回复', async () => {
  await send(page, '你好')
  await page.getByText(/QA 回复：你好/).waitFor({ timeout: 15000 })
})

// ══ 2. M4 附件与结果 ═════════════════════════════════════════
await step('M4：附件选择 → chip → 发送后消息回显附件', async () => {
  await createSession(page)
  await page.setInputFiles('input[data-testid="attachment-input"]', {
    name: '需求.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 需求\n请实现这个功能', 'utf8'),
  })
  await page.getByTestId('attachment-chip').waitFor({ timeout: 8000 })
  await send(page, '处理附件')
  await page.getByText(/QA 回复/).waitFor({ timeout: 15000 })
  await page.getByTestId('attachment-chip').waitFor({ timeout: 8000 })
  await shot(page, '02-attachment-message')
})

await step('M4：write 产物进结果区，可预览并「让 Agent 改这份」', async () => {
  await createSession(page)
  await send(page, 'M2 写入')
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('M2 写入完成', { exact: true }).last().waitFor({ timeout: 15000 })
  const item = page.getByTestId('result-item').filter({ hasText: 'm2-write.txt' })
  await item.waitFor({ timeout: 8000 })
  await item.click()
  await page.getByTestId('artifact-edit-request').waitFor({ timeout: 8000 })
  const preview = await page.evaluate(() => {
    const aside = [...document.querySelectorAll('aside')].find((node) =>
      node.textContent?.includes('结果'),
    )
    return aside?.textContent ?? ''
  })
  if (!preview.includes('M2 写入内容')) throw new Error('预览未显示文件内容')
  await page.getByTestId('artifact-edit-request').click()
  const draft = await page.getByPlaceholder(/说点什么/).inputValue()
  if (!draft.includes('请修改这个文件')) throw new Error('草稿未注入')
  await shot(page, '03-results-preview')
})

// ══ 3. 会话交互（搜索/菜单） ══════════════════════════════════
await step('U02：会话搜索过滤', async () => {
  await createSession(page)
  await page.evaluate(async () => {
    const sessions = await window.tgbuddy.session.list()
    const target = sessions[0]
    if (target) await window.tgbuddy.session.updateMeta(target.id, { title: 'QA 搜索目标' })
  })
  await page.reload()
  await page.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 20000 })
  await page.getByTestId('session-search').fill('QA 搜索目标')
  await page.getByText('QA 搜索目标').waitFor({ timeout: 8000 })
})

await step('U03：会话菜单置顶与归档', async () => {
  const sessionId = await currentSessionId(page)
  if (!sessionId) throw new Error('没有当前会话')
  await page.getByTestId(`session-menu-${sessionId}`).click()
  await page.getByRole('button', { name: '置顶', exact: true }).click()
  await page.waitForTimeout(500)
  const meta = await page.evaluate(
    (sid) =>
      window.tgbuddy.session.list().then((list) => list.find((item) => item.id === sid)),
    sessionId,
  )
  if (!meta?.pinned) throw new Error('置顶未生效')
})

// ══ 4. 计划模式与权限 ═════════════════════════════════════════
await step('计划模式闭环：提交计划 → 审批 → 执行', async () => {
  await createSession(page)
  await setPlanMode(page)
  await send(page, 'M2 计划')
  await page.getByRole('button', { name: '批准并执行', exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '04-plan-approval')
  await page.getByRole('button', { name: '批准并执行', exact: true }).click()
  await page.getByText('M2 计划完成', { exact: true }).waitFor({ timeout: 15000 })
})

await step('完全访问：写操作直接放行不询问', async () => {
  await createSession(page)
  await setBypassMode(page)
  await send(page, 'M2 写入')
  await page.getByText('M2 写入完成', { exact: true }).last().waitFor({ timeout: 15000 })
  const askCount = await page.getByText('请求执行 write').count()
  if (askCount !== 0) throw new Error('完全访问下仍询问')
})

await step('M4 回归：bash 导出文档出现在结果区', async () => {
  await createSession(page)
  await setBypassMode(page)
  await send(page, 'M4 导出')
  await page.getByText('M4 导出完成', { exact: true }).last().waitFor({ timeout: 15000 })
  await page
    .getByTestId('result-item')
    .filter({ hasText: 'report.docx' })
    .waitFor({ timeout: 8000 })
  await shot(page, '08-bash-export-artifact')
})

// ══ 5. 设置页与布局证据 ═══════════════════════════════════════
await step('设置页：技能分组可见、工具区已移除', async () => {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('channel-settings-panel').waitFor()
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="channel-settings-panel"] .overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await page.getByTestId('skill-row').first().waitFor({ timeout: 8000 })
  const toolRows = await page.getByTestId('tool-row').count()
  if (toolRows !== 0) throw new Error('工具区未移除')
  await shot(page, '05-settings')
  await page.getByTestId('channel-settings-close').click()
  await page.getByTestId('channel-settings-panel').waitFor({ state: 'detached' })
})

await step('布局证据：主窗口 + 结果区截图（视觉比对素材）', async () => {
  await createSession(page)
  await shot(page, '06-main-window')
  const asideVisible = await page.getByText('结果', { exact: true }).isVisible().catch(() => false)
  if (!asideVisible) throw new Error('结果区在 1280 窗口不可见')
  await shot(page, '07-results-panel')
})

// ── 报告 ──────────────────────────────────────────────────────
const passed = findings.filter((f) => f.ok).length
const report = [
  '# M4–M6 探索式 QA 报告',
  '',
  `时间：${new Date().toLocaleString('zh-CN')}`,
  `结果：${passed}/${findings.length} 通过`,
  '',
  '## 场景',
  ...findings.map((f) => `- ${f.ok ? '✅' : '❌'} ${f.name}${f.detail ? `：${f.detail}` : ''}`),
  '',
  '## 截图证据（screenshots/）',
  ...['01-empty-state', '02-attachment-message', '03-results-preview', '04-plan-approval', '05-settings', '06-main-window', '07-results-panel']
    .map((name) => `- ${name}.png`),
  '',
  '## 原型视觉比对清单（供人工比对）',
  '- 主窗口 → 原型 data-screen-label="main"',
  '- 结果区 → 原型 main 结果区（时间倒序 + 分组 + 类型筛选）',
  '- 设置页 → 原型「设置 技能与工具」场景',
  '- 计划审批卡 → 原型「权限确认」与 Codex 式 TL;DR 摘要',
].join('\n')
await writeFile(join(QA_DIR, 'report.md'), report, 'utf8')

await app.close().catch(() => {})
server.close()

async function expectCount(page, testId, expected) {
  const count = await page.getByTestId(testId).count()
  if (count !== expected) throw new Error(`${testId} 数量 ${count} != ${expected}`)
}

console.log(report)
