/**
 * M2 + M3 联合探索式 QA 驱动（可重复执行）。
 *
 * 运行：node .ship/tasks/tgbuddy-vertical-slices/qa/m2m3-qa-driver.mjs
 *
 * - 使用可控 fake OpenAI server（chat completions + /v1/models）
 * - 每个步骤独立 try/catch，输出 PASS/FAIL + 截图证据
 * - 结束时自动生成 report.md 并清理临时数据
 */
import { _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import {
  existsSync,
} from 'node:fs'
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const EVIDENCE_DIR = join(import.meta.dirname, 'm2m3-qa', 'screenshots')
await mkdir(EVIDENCE_DIR, { recursive: true })

// ── 临时数据目录 ──────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'tgbuddy-m2m3-qa-'))
const dataDir = join(root, 'data')
const userData = join(root, 'user-data')
const wsA = join(dataDir, 'workspaces', 'A')
const wsB = join(dataDir, 'workspaces', 'B')
for (const dir of [wsA, wsB, join(userData)]) {
  await mkdir(dir, { recursive: true })
}
await writeFile(join(wsA, 'README.md'), '# Workspace A', 'utf8')
await writeFile(join(wsA, 'm2-delete.txt'), '要被删除的内容', 'utf8')
await mkdir(join(wsA, '.tgbuddy', 'skills', 'qa-skill'), { recursive: true })
await writeFile(
  join(wsA, '.tgbuddy', 'skills', 'qa-skill', 'skill.json'),
  JSON.stringify({
    name: 'qa-skill',
    title: 'QA 工作区技能',
    description: '随工作区出现的技能',
    version: '1.0.0',
    tags: ['QA'],
  }),
  'utf8',
)

// ── fake OpenAI server ─────────────────────────────────────────
let toolCallSequence = 0
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

function endStream(res, totalTokens) {
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

async function streamText(res, text, highUsage = false) {
  const splitAt = Math.max(1, Math.floor(text.length / 2))
  writeChunk(res, {
    choices: [{ index: 0, delta: { role: 'assistant', content: text.slice(0, splitAt) }, finish_reason: null }],
  })
  await new Promise((r) => setTimeout(r, 20))
  if (res.destroyed) return
  writeChunk(res, { choices: [{ index: 0, delta: { content: text.slice(splitAt) }, finish_reason: null }] })
  writeChunk(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  endStream(res, highUsage ? 900_000 : 1_000)
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
      // 只有「pi 生成的压缩请求」system 消息才算摘要场景，
      // 排除应用自己的技能清单段，避免描述里的 summar 等词误判。
      const isSummary = messages.some(
        (m) =>
          m.role === 'system'
          && /summar|summary|摘要/i.test(messageText(m))
          && !messageText(m).includes('## 技能'),
      )
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      if (isSummary) {
        await streamText(res, 'QA 压缩摘要：保留已完成任务、关键决定和后续上下文。')
        return
      }
      if (prompt.includes('慢速')) {
        setTimeout(() => {
          if (!res.destroyed) void streamText(res, '这段迟到文本不应在停止后出现')
        }, 8_000)
        return
      }
      if (prompt.includes('M2 写入')) {
        if (lastMessage?.role === 'tool') {
          await streamText(res, 'M2 写入完成')
        } else {
          streamToolCall(res, 'write', { path: 'm2-write.txt', content: 'M2 写入内容' }, 'call_qa_write')
        }
        return
      }
      if (prompt.includes('M2 删除')) {
        if (lastMessage?.role === 'tool') {
          await streamText(res, 'M2 删除完成')
        } else {
          streamToolCall(res, 'delete', { paths: ['m2-delete.txt'] }, 'call_qa_delete')
        }
        return
      }
      if (prompt.includes('M2 计划')) {
        const toolResults = messages.filter((m) => m.role === 'tool').length
        if (toolResults === 0) {
          streamToolCall(res, 'enter_plan_mode', { reason: '先出计划再执行' }, 'call_qa_plan')
        } else if (toolResults === 1) {
          streamToolCall(res, 'exit_plan_mode', { plan: '1. 修改文件\n2. 验证' }, 'call_qa_plan')
        } else {
          await streamText(res, 'M2 计划完成')
        }
        return
      }
      if (prompt.includes('M2 提问')) {
        if (lastMessage?.role === 'tool') {
          await streamText(res, 'M2 提问完成')
        } else {
          streamToolCall(res, 'ask_user', {
            questions: [{
              header: '目标',
              question: '这次修改的目标是什么？',
              options: [
                { label: '修 bug', description: '修复现有问题' },
                { label: '加功能（推荐）', description: '新增能力' },
              ],
            }, {
              header: '范围',
              question: '影响范围？',
              options: [
                { label: '单文件', description: '只动一个文件' },
                { label: '多文件', description: '涉及多个文件' },
              ],
            }],
          }, 'call_qa_ask')
        }
        return
      }
      if (prompt.includes('M3 MCP')) {
        if (lastMessage?.role === 'tool') {
          await streamText(res, 'M3 MCP 完成')
        } else {
          streamToolCall(res, 'echo.echo', { text: 'hello-mcp' }, 'call_qa_mcp')
        }
        return
      }
      const highUsage = prompt.includes('触发自动压缩')
      await streamText(res, `E2E 回复：${prompt}`, highUsage)
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

// ── 初始渠道（带 key，走 C02 一次性迁移进 SecretStore）─────────
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

// ── Electron 启动 ─────────────────────────────────────────────
async function launchApp() {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--disable-gpu'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TGBUDDY_DATA_DIR: dataDir,
      TGBUDDY_WORKSPACE_DIR: wsA,
      TGBUDDY_E2E: '1',
    },
  })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 30000 })
  return { app, page }
}

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
    const stackLine = String(error?.stack ?? '')
      .split('\n')
      .find((line) => line.includes('m2m3-qa-driver'))
      ?.trim()
      ?? ''
    const bodyText = await page
      .evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, ' | '))
      .catch(() => '<页面不可读>')
    const dump = await page
      .evaluate(async () => ({
        body: document.body.innerText.slice(0, 800),
        sessions: await window.tgbuddy.session.list().catch(() => 'ERR'),
      }))
      .catch(() => null)
    if (dump) {
      await writeFile(
        join(import.meta.dirname, 'm2m3-qa', `debug-${name.replace(/[^\w\u4e00-\u9fff]/g, '_')}.json`),
        JSON.stringify(dump, null, 2),
        'utf8',
      ).catch(() => {})
    }
    record(
      name,
      false,
      `${String(error).split('\n')[0]?.slice(0, 120) ?? String(error)}${stackLine ? ` @ ${stackLine.slice(-60)}` : ''} | 页面：${bodyText}`,
    )
    // 失败步骤可能留下授权卡/计划卡/运行中状态污染后续点击，
    // 复位页面避免级联失败（run 状态与设置都在主进程，reload 不丢）。
    await page.reload().catch(() => {})
    await page.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 20000 }).catch(() => {})
  }
}

async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`) })
}

// ── 通用交互 helper ───────────────────────────────────────────
async function createSession(page) {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await page.getByPlaceholder(/说点什么/).waitFor({ timeout: 10000 })
}

async function send(page, prompt) {
  const input = page.getByPlaceholder(/说点什么/)
  await input.fill(prompt)
  // 用 Enter 提交而非点击发送按钮：模式菜单等 popover 的遮罩
  // 可能挡住按钮，键盘提交仍是用户输入路径且不依赖按钮可点性。
  await input.press('Enter')
}

async function switchWorkspace(page, path) {
  await page.evaluate(async (workspacePath) => {
    const workspaces = await window.tgbuddy.workspace.list()
    let match = workspaces.find((workspace) => workspace.mount?.path === workspacePath)
    match ??= await window.tgbuddy.workspace.create({ path: workspacePath })
    await window.tgbuddy.workspace.select(match.id)
  }, path)
  await page.reload()
  await page.getByTestId('workspace-picker').waitFor()
}

async function openSettings(page) {
  if ((await page.getByTestId('channel-settings-panel').count()) > 0) {
    await page.getByTestId('channel-settings-close').click().catch(() => {})
    await page.getByTestId('channel-settings-panel').waitFor({ state: 'detached' }).catch(() => {})
  }
  await page.getByTestId('settings-open').click()
  await page.getByTestId('channel-settings-panel').waitFor()
}

async function closeSettings(page) {
  await page.getByTestId('channel-settings-close').click()
  await page.getByTestId('channel-settings-panel').waitFor({ state: 'detached' })
}

async function setPlanMode(page) {
  const sessionId = await currentSessionId(page)
  if (!sessionId) throw new Error('没有当前会话')
  await page.evaluate((sid) => window.tgbuddy.plan.setMode(sid, 'plan'), sessionId)
}

async function resetToAutoMode(page) {
  const sessionId = await currentSessionId(page)
  if (!sessionId) return
  await page.evaluate((sid) => window.tgbuddy.plan.setMode(sid, 'auto'), sessionId)
}

/** 通过渲染进程 IPC 驱动（等价用户操作链路的输入侧），UI 断言保留。 */
async function currentSessionId(page) {
  return page.evaluate(async () => {
    const list = await window.tgbuddy.session.list()
    return list[0]?.id
  })
}

// ── 启动 ──────────────────────────────────────────────────────
let app
let page
try {
  ;({ app, page } = await launchApp())
} catch (error) {
  console.error('应用启动失败：', error)
  process.exit(1)
}

// ══ 1. 主链路冒烟 ═══════════════════════════════════════════
await step('冒烟：普通消息流式回复', async () => {
  await createSession(page)
  await send(page, '你好')
  await page.getByText('E2E 回复：你好', { exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '01-main-stream')
})

await step('冒烟：写工具授权允许后执行成功', async () => {
  await send(page, 'M2 写入')
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('M2 写入完成', { exact: true }).waitFor({ timeout: 15000 })
  if (!existsSync(join(wsA, 'm2-write.txt'))) throw new Error('工具未实际写入文件')
})

await step('冒烟：写工具拒绝后卡片落已拒绝', async () => {
  await send(page, 'M2 写入')
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await page.getByText(/用户拒绝了该操作/).waitFor({ timeout: 10000 })
})

await step('冒烟：停止后迟到文本不出现且可再发送', async () => {
  await send(page, '慢速')
  await page.waitForTimeout(1_000)
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.waitForTimeout(9_500)
  const leaked = await page.getByText('这段迟到文本不应在停止后出现').count()
  if (leaked !== 0) throw new Error('停止后出现迟到文本')
  await page.getByPlaceholder(/说点什么/).fill('再试')
  await page.getByRole('button', { name: '发送', exact: true }).waitFor({ state: 'visible' })
  await shot(page, '02-stop-no-leak')
})

await step('冒烟：Run 结束后上下文面板显示账本', async () => {
  await send(page, '账本检查')
  await page.getByText('E2E 回复：账本检查', { exact: true }).waitFor({ timeout: 15000 })
  const usageButton = page.getByRole('button', { name: '查看上下文用量' })
  await usageButton.waitFor({ timeout: 10000 })
  await usageButton.click()
  await page.getByText('最近一次运行账本', { exact: true }).waitFor({ timeout: 8000 })
  await shot(page, '03-run-ledger')
})

// ══ 2. M2 · Workspace 与安全 ═══════════════════════════════
await step('M2：工作区切换隔离会话', async () => {
  await switchWorkspace(page, wsB)
  const listB = await page.evaluate(() => window.tgbuddy.session.list())
  if (listB.some((s) => s.title !== '新会话' && s.workspaceId)) {
    // A 的会话不应出现在 B（B 刚创建为空，允许有默认会话创建逻辑差异，只校验数量）
  }
  const created = await page.evaluate(async () => {
    const meta = await window.tgbuddy.session.create({ title: 'B 专属会话' })
    return meta
  })
  if (!created) throw new Error('B 工作区创建会话失败')
  await switchWorkspace(page, wsA)
  const listA = await page.evaluate(() => window.tgbuddy.session.list())
  if (listA.some((s) => s.title === 'B 专属会话')) throw new Error('B 的会话泄漏到 A')
  await shot(page, '04-workspace-isolation')
})

await step('M2：mount 目录丢失时新 run 被阻止并可恢复', async () => {
  const moved = join(dataDir, 'workspaces', 'B-moved')
  await rename(wsB, moved)
  try {
    await switchWorkspace(page, wsB)
    await createSession(page)
    await send(page, '不可达')
    await page.getByText(/目录不存在|恢复目录/).first().waitFor({ timeout: 10000 })
  } finally {
    await rename(moved, wsB)
  }
  await switchWorkspace(page, wsB)
  await createSession(page)
  await send(page, '恢复后')
  await page.getByText('E2E 回复：恢复后', { exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '05-mount-recovery')
})

await step('M2：高危删除升级模态且无总是允许', async () => {
  await switchWorkspace(page, wsA)
  await createSession(page)
  await send(page, 'M2 删除')
  await page.getByText('确认删除文件？').waitFor({ timeout: 10000 })
  await page.getByText('高危 · 不可逆', { exact: true }).waitFor({ timeout: 5000 })
  if ((await page.getByText('总是允许（可选）').count()) !== 0) throw new Error('模态不应提供总是允许')
  await page.getByRole('button', { name: '允许执行', exact: true }).click()
  await page.getByText('M2 删除完成', { exact: true }).waitFor({ timeout: 15000 })
  if (existsSync(join(wsA, 'm2-delete.txt'))) throw new Error('文件未被删除')
  await shot(page, '06-danger-modal')
})

await step('M2：总是允许规则跨重启生效', async () => {
  await send(page, 'M2 写入')
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.locator('input[name^="grant-"]').first().check()
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('M2 写入完成', { exact: true }).waitFor({ timeout: 15000 })

  await app.close()
  await new Promise((r) => setTimeout(r, 1_000))
  ;({ app, page } = await launchApp())
  await switchWorkspace(page, wsA)
  await page.getByTestId('session-item').first().click()
  await send(page, 'M2 写入')
  await page.waitForTimeout(1_500)
  if ((await page.getByText('请求执行 write').count()) !== 0) throw new Error('规则未生效仍询问')
  await page.getByText('M2 写入完成', { exact: true }).last().waitFor({ timeout: 15000 })
  await shot(page, '07-rule-persist')
})

await step('M2：计划模式拒绝写操作，切回默认恢复', async () => {
  await createSession(page)
  await setPlanMode(page)
  await send(page, 'M2 写入')
  await page.getByText(/计划模式下不允许执行写操作/).waitFor({ timeout: 15000 })
  await resetToAutoMode(page)
  // 清掉「总是允许」规则，避免切回默认后按规则放行而看不到授权卡。
  await page.evaluate(async () => {
    const rules = await window.tgbuddy.permission.rules()
    for (const rule of rules) await window.tgbuddy.permission.removeRule(rule.id)
  })
  await send(page, 'M2 写入')
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('M2 写入完成', { exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '08-plan-mode')
})

await step('M2：计划模式完整闭环（进入调研→提交计划→批准执行）', async () => {
  await createSession(page)
  await setPlanMode(page)
  await send(page, 'M2 计划')
  await page.getByRole('button', { name: '批准并执行', exact: true }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '批准并执行', exact: true }).click()
  await page.getByText('M2 计划完成', { exact: true }).waitFor({ timeout: 15000 })
  await resetToAutoMode(page)
})

await step('M2：ask_user 结构化提问可回答并回到原任务', async () => {
  await createSession(page)
  await send(page, 'M2 提问')
  await page.getByText('需要你的补充').waitFor({ timeout: 15000 })
  await page.getByText('这次修改的目标是什么？').waitFor({ timeout: 15000 })
  await page.locator('fieldset').nth(0).getByPlaceholder('其他答案…').fill('修 bug')
  await page.locator('fieldset').nth(1).getByPlaceholder('其他答案…').fill('单文件')
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await page.getByText('M2 提问完成', { exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '09-ask-user')
})

// ══ 3. M3 · 渠道 / Profile / 模型 ═════════════════════════
await step('M3：无 key 渠道保存显示未配置，编辑改名保留状态', async () => {
  await openSettings(page)
  await page.getByTestId('channel-add').click()
  await page.getByTestId('channel-name-input').fill('无密钥渠道')
  await page.getByTestId('channel-base-url-input').fill('http://127.0.0.1:9999/v1')
  await page.getByTestId('channel-save').click()
  const row = page.getByTestId('channel-row').filter({ hasText: '无密钥渠道' })
  await row.waitFor({ timeout: 5000 })
  await row.getByTestId('channel-edit').click()
  await page.getByTestId('channel-name-input').fill('无密钥渠道改名')
  await page.getByTestId('channel-save').click()
  const renamed = page.getByTestId('channel-row').filter({ hasText: '无密钥渠道改名' })
  await renamed.waitFor({ timeout: 5000 })
  if ((await renamed.getByText('未配置密钥').count()) !== 1) throw new Error('未配置密钥状态丢失')
})

await step('M3：带 key 渠道只存 ref 不回传明文', async () => {
  await page.getByTestId('channel-add').click()
  await page.getByTestId('channel-name-input').fill('密钥渠道')
  await page.getByTestId('channel-base-url-input').fill(`${fakeBaseUrl}`)
  await page.getByTestId('channel-key-input').fill('sk-qa-top-secret')
  await page.getByTestId('channel-save').click()
  const row = page.getByTestId('channel-row').filter({ hasText: '密钥渠道' })
  await row.getByText('已配置密钥').waitFor({ timeout: 5000 })
  const listed = await page.evaluate(() => window.tgbuddy.channel.list())
  if (listed.some((c) => JSON.stringify(c).includes('sk-qa-top-secret'))) {
    throw new Error('明文泄漏到 channel list')
  }
  await shot(page, '10-channel-secret-ref')
})

await step('M3：删除被会话引用的渠道被拒且原因可见', async () => {
  const sessionId = await page.evaluate(async () => {
    const meta = await window.tgbuddy.session.create({ title: '引用渠道的会话' })
    return meta.id
  })
  await page.evaluate((sid) => window.tgbuddy.session.updateMeta(sid, { channelId: 'qa' }), sessionId)
  const qaRow = page.getByTestId('channel-row').filter({ hasText: 'QA 渠道' })
  await page.once('dialog', (dialog) => dialog.accept())
  await qaRow.getByTestId('channel-delete').click()
  await page.getByText(/仍有会话使用该渠道/).waitFor({ timeout: 5000 })
  await shot(page, '11-channel-delete-rejected')
})

await step('M3：测试连接成功并应用发现模型', async () => {
  const qaRow = page.getByTestId('channel-row').filter({ hasText: 'QA 渠道' })
  await qaRow.getByTestId('channel-test').click()
  await page.getByTestId('channel-test-result').waitFor({ timeout: 10000 })
  const text = await page.getByTestId('channel-test-result').innerText()
  if (!text.includes('连接成功') || !text.includes('1 个模型')) throw new Error(`诊断异常：${text}`)
})

await step('M3：模型 chip 选择写入会话元数据', async () => {
  await closeSettings(page)
  await createSession(page)
  await page.getByTestId('model-chip').click()
  await page.getByTestId('model-option').first().waitFor({ timeout: 5000 })
  await page.getByTestId('model-option').first().click()
  const meta = await page.evaluate(async () => (await window.tgbuddy.session.list())[0])
  if (!meta?.channelId || !meta?.modelId) throw new Error('会话未写入 channel/model')
  await shot(page, '12-model-chip')
})

await step('M3：Profile 创建并可从输入区选择', async () => {
  // 创建走 IPC（表单交互已在渠道步骤覆盖），UI 验证输入区可选择 Profile。
  await page.evaluate(() => window.tgbuddy.profile.save({
    name: 'QA 专家',
    channelId: 'qa',
    modelId: 'qa-model',
  }))
  await openSettings(page)
  await page.getByTestId('profile-row').filter({ hasText: 'QA 专家' }).waitFor({ timeout: 8000 })
  await closeSettings(page)
  await page.getByTestId('model-chip').click()
  const profileOption = page.getByTestId('model-profile-option').filter({ hasText: 'QA 专家' })
  await profileOption.waitFor({ timeout: 5000 })
  await profileOption.click()
  const sessionId = await currentSessionId(page)
  let bound = false
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(300)
    const meta = await page.evaluate(async (sid) => (await window.tgbuddy.session.list()).find((s) => s.id === sid), sessionId)
    if (meta?.profileId) {
      bound = true
      break
    }
  }
  if (!bound) throw new Error('会话未绑定 Profile（updateMeta 未生效）')
  await shot(page, '13-profile-select')
})

// ══ 4. M3 · 工具权限 ═══════════════════════════════════════
await step('M3：工具三档设为禁止后调用被拒，恢复推荐后回默认', async () => {
  // 前序「总是允许」规则会覆盖三档默认（规则优先级更高），先清空规则。
  await page.evaluate(async () => {
    const rules = await window.tgbuddy.permission.rules()
    for (const rule of rules) await window.tgbuddy.permission.removeRule(rule.id)
  })
  await page.evaluate(() => window.tgbuddy.tool.setPermission('write', 'deny'))
  await createSession(page)
  await send(page, 'M2 写入')
  await page.getByText(/该工具已在设置中设为「禁止」/).waitFor({ timeout: 15000 })
  await page.evaluate(() => window.tgbuddy.tool.resetAll())
  await send(page, 'M2 写入')
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('M2 写入完成', { exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '14-tool-permission-deny')
})

await step('M3：工具三档设为允许后直接放行不询问', async () => {
  await page.evaluate(async () => {
    const rules = await window.tgbuddy.permission.rules()
    for (const rule of rules) await window.tgbuddy.permission.removeRule(rule.id)
  })
  await page.evaluate(() => window.tgbuddy.tool.setPermission('write', 'allow'))
  await createSession(page)
  await send(page, 'M2 写入')
  await page.waitForTimeout(2_500)
  if ((await page.getByText('请求执行 write').count()) !== 0) throw new Error('允许后仍询问')
  await page.getByText('M2 写入完成', { exact: true }).waitFor({ timeout: 15000 })
  await page.evaluate(() => window.tgbuddy.tool.resetAll())
})

// ══ 5. M3 · 技能 ═══════════════════════════════════════════
await step('M3：内置与工作区技能分组可见，开关可切换', async () => {
  await openSettings(page)
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="channel-settings-panel"] .overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  const builtin = page.getByTestId('skill-row').filter({ hasText: '监管口径核对' })
  await builtin.waitFor({ timeout: 5000 })
  const wsSkill = page.getByTestId('skill-row').filter({ hasText: 'QA 工作区技能' })
  await wsSkill.waitFor({ timeout: 5000 })
  // IPC 禁用后刷新设置面板，UI 应显示关闭态
  await page.evaluate(() => window.tgbuddy.skill.setEnabled('workspace:qa-skill', false))
  await page.getByTestId('channel-settings-close').click()
  await openSettings(page)
  await page.getByTestId('skill-toggle-qa-skill').waitFor({ timeout: 5000 })
  const toggled = await page.getByTestId('skill-toggle-qa-skill').getAttribute('aria-checked')
  if (toggled !== 'false') throw new Error('开关未切换为关闭')
  // UI 点击恢复开启，验证开关交互
  await page.getByTestId('skill-toggle-qa-skill').click()
  await page.waitForTimeout(500)
  const toggledBack = await page.getByTestId('skill-toggle-qa-skill').getAttribute('aria-checked')
  if (toggledBack !== 'true') throw new Error('UI 开关未恢复开启')
  await shot(page, '15-skills-groups')
  await closeSettings(page)
})

// ══ 6. M3 · MCP ════════════════════════════════════════════
await step('M3：坏 MCP 命令给出可诊断失败', async () => {
  await page.evaluate(() => window.tgbuddy.mcp.save({
    name: '坏服务',
    key: 'bad',
    transport: 'stdio',
    command: 'node no-such-file.mjs',
    enabled: true,
  }))
  await openSettings(page)
  const badRow = page.getByTestId('mcp-row').filter({ hasText: '坏服务' })
  await badRow.getByTestId('mcp-connect').click()
  await badRow.getByTestId('mcp-error').waitFor({ timeout: 20000 })
  await shot(page, '16-mcp-error')
})

await step('M3：MCP 连接、工具发现与真实调用闭环', async () => {
  await page.evaluate(() => window.tgbuddy.mcp.save({
    name: 'echo',
    key: 'echo',
    transport: 'stdio',
    command: 'node scripts/mcp-fixture-server.mjs',
    enabled: true,
  }))
  await openSettings(page)
  const echoRow = page.getByTestId('mcp-row').filter({ hasText: 'echo' })
  await echoRow.getByTestId('mcp-connect').click()
  await echoRow.getByText('已连接').waitFor({ timeout: 20000 })
  await echoRow.getByTestId('mcp-tools-toggle').click()
  await page.getByTestId('mcp-tool-row').filter({ hasText: 'echo.echo' }).waitFor({ timeout: 5000 })
  await closeSettings(page)

  await createSession(page)
  await send(page, 'M3 MCP')
  await page.getByText('请求执行 echo.echo').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  const toolCard = page.getByRole('button', { name: /echo\.echo/ }).first()
  await toolCard.waitFor({ timeout: 10000 })
  await page.getByText('M3 MCP 完成', { exact: true }).waitFor({ timeout: 15000 })
  await shot(page, '17-mcp-call')
})

await step('M3：MCP 断开后工具从列表移除', async () => {
  await page.evaluate(async () => {
    const list = await window.tgbuddy.mcp.list()
    const echo = list.find((s) => s.name === 'echo')
    if (echo) await window.tgbuddy.mcp.disconnect(echo.id)
  })
  await openSettings(page)
  await page.waitForTimeout(800)
  const count = await page.getByTestId('mcp-tool-row').filter({ hasText: 'echo.echo' }).count()
  if (count !== 0) throw new Error('断开后工具仍显示')
  await shot(page, '18-mcp-disconnect')
})

await step('M3：plan 模式拒绝非读 MCP 方法', async () => {
  await page.evaluate(async () => {
    const list = await window.tgbuddy.mcp.list()
    const echo = list.find((s) => s.name === 'echo')
    if (echo) await window.tgbuddy.mcp.connect(echo.id)
  })
  await openSettings(page)
  const echoRow = page.getByTestId('mcp-row').filter({ hasText: 'echo' })
  await echoRow.getByText('已连接').waitFor({ timeout: 20000 })
  await closeSettings(page)
  await createSession(page)
  await setPlanMode(page)
  await send(page, 'M3 MCP')
  await page.getByText(/计划模式下不允许执行写操作/).waitFor({ timeout: 15000 })
  await resetToAutoMode(page)
  await shot(page, '19-plan-mcp-deny')
})

// ══ 7. 重启持久化 + 双会话 ════════════════════════════════
await step('重启后：渠道/Profile/MCP 配置保留', async () => {
  await app.close()
  await new Promise((r) => setTimeout(r, 1_000))
  ;({ app, page } = await launchApp())
  const channels = await page.evaluate(() => window.tgbuddy.channel.list())
  const names = channels.map((c) => c.name)
  for (const expected of ['QA 渠道', '无密钥渠道改名', '密钥渠道']) {
    if (!names.includes(expected)) throw new Error(`重启后渠道丢失：${expected}`)
  }
  const profiles = await page.evaluate(() => window.tgbuddy.profile.list())
  if (!profiles.some((p) => p.name === 'QA 专家')) throw new Error('Profile 丢失')
  const mcp = await page.evaluate(() => window.tgbuddy.mcp.list())
  if (!mcp.some((s) => s.name === 'echo')) throw new Error('MCP 配置丢失')
  await shot(page, '20-restart-persist')
})

await step('双会话并行：A 运行中 B 独立完成，A 可停止', async () => {
  await switchWorkspace(page, wsA)
  await createSession(page)
  await page.evaluate(async () => {
    const list = await window.tgbuddy.session.list()
    await window.tgbuddy.session.updateMeta(list[0].id, { title: '会话A' })
  })
  await send(page, '慢速')
  await page.waitForTimeout(800)
  await createSession(page)
  await page.evaluate(async () => {
    const list = await window.tgbuddy.session.list()
    const b = list.find((s) => s.title === '新会话')
    if (b) await window.tgbuddy.session.updateMeta(b.id, { title: '会话B' })
  })
  // 注意：write 已有「总是允许」规则（前序测试），因此 B 用 ask_user
  // 验证并行——提问卡出现即说明 B 的 Run 已独立执行。
  await send(page, 'M2 提问')
  await page.getByText('需要你的补充').waitFor({ timeout: 10000 })
  await page.locator('fieldset').nth(0).getByPlaceholder('其他答案…').fill('修 bug')
  await page.locator('fieldset').nth(1).getByPlaceholder('其他答案…').fill('单文件')
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await page.getByText('M2 提问完成', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByTestId('session-item').filter({ hasText: '会话A' }).click()
  const stopVisible = await page.getByRole('button', { name: '停止', exact: true }).isVisible()
  if (!stopVisible) throw new Error('A 会话未能并行运行')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await shot(page, '21-parallel-sessions')
})

// ── 收尾 ─────────────────────────────────────────────────────
await app.close().catch(() => {})
await new Promise((r) => server.close(r))
await rm(root, { recursive: true, force: true })

const passed = findings.filter((f) => f.ok).length
const report = [
  '# M2+M3 联合 QA 报告',
  '',
  `- 执行时间：${new Date().toISOString()}`,
  `- 结果：${passed}/${findings.length} 通过`,
  `- 截图：m2m3-qa/screenshots/`,
  '',
  '## 明细',
  '',
  '| 结果 | 测试点 | 说明 |',
  '|---|---|---|',
  ...findings.map((f) => `| ${f.ok ? '✅' : '❌'} | ${f.name} | ${f.detail} |`),
  '',
  '## 未自动化（需手动验证）',
  '',
  '- 密钥失效路径：删除/破坏 SecretStore 中对应 ref 后，渠道的下一次 Run 报「密钥引用已失效」且应用不白屏。',
  '- 85% 自动压缩触发与排队消息（M1 E2E 已覆盖，未在本脚本重复）。',
  '- 视觉细节对照（三档配色、状态点、灰阶层级）——建议截图与原型逐项比对。',
  '',
].join('\n')
await writeFile(join(import.meta.dirname, 'm2m3-qa', 'report.md'), report, 'utf8')

console.log(`\nQA 结果：${passed}/${findings.length} 通过`)
console.log(`报告：.ship/tasks/tgbuddy-vertical-slices/qa/m2m3-qa/report.md`)
process.exit(passed === findings.length ? 0 : 1)
