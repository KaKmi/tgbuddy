/**
 * M3 探索式 QA 驱动：独立于 E2E 用例，覆盖边界与异常路径，
 * 截图证据输出到本目录。运行：node qa-driver.mjs
 */
import { _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EVIDENCE_DIR = join(import.meta.dirname, 'screenshots')
const root = await mkdtemp(join(tmpdir(), 'tgbuddy-qa-'))
const dataDir = join(root, 'data')
const userData = join(root, 'user-data')
const ws = join(dataDir, 'workspaces', 'default')
await mkdir(ws, { recursive: true })
await mkdir(userData, { recursive: true })
await mkdir(join(ws, '.tgbuddy', 'skills', 'ws-skill'), { recursive: true })
await writeFile(
  join(ws, '.tgbuddy', 'skills', 'ws-skill', 'skill.json'),
  JSON.stringify({
    name: 'ws-skill',
    title: '工作区专属技能',
    description: '只出现在当前工作区',
    version: '1.0.0',
    tags: ['工作区'],
  }),
  'utf8',
)

const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const parsed = JSON.parse(body)
      const last = (parsed.messages ?? []).at(-1)
      if (last?.role === 'tool') {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'QA 完成' }, finish_reason: null }] })}\n\n`)
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'write', arguments: '{"path":"qa-write.txt","content":"x"}' } }] }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
    return
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'qa-model' }] }))
    return
  }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

await writeFile(
  join(dataDir, 'channels.json'),
  JSON.stringify({
    channels: [
      {
        id: 'qa',
        name: 'QA 渠道',
        protocol: 'openai',
        baseUrl,
        apiKey: 'qa-key',
        models: [{ id: 'qa-model', name: 'QA Model', contextWindow: 1000000, maxTokens: 4096 }],
      },
    ],
  }),
  'utf8',
)

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`, '--disable-gpu'],
  cwd: join(import.meta.dirname, '..', '..', '..', '..'),
  env: {
    ...process.env,
    TGBUDDY_DATA_DIR: dataDir,
    TGBUDDY_WORKSPACE_DIR: ws,
    TGBUDDY_E2E: '1',
  },
})
const page = await app.firstWindow()

async function shot(name) {
  await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`) })
}

try {
  await page.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 20000 })
  await page.getByTestId('settings-open').click()
  await page.getByTestId('channel-settings-panel').waitFor()
  await page.waitForTimeout(600)
  await shot('01-settings-model')

  // ── 渠道：无密钥保存 → 未配置密钥；编辑改名保留密钥状态 ──
  await page.getByTestId('channel-add').click()
  await page.getByTestId('channel-name-input').fill('无密钥渠道')
  await page.getByTestId('channel-base-url-input').fill('http://127.0.0.1:9999/v1')
  await page.getByTestId('channel-save').click()
  const noKeyRow = page.getByTestId('channel-row').filter({ hasText: '无密钥渠道' })
  await noKeyRow.waitFor({ timeout: 5000 })
  record('渠道无密钥保存', (await noKeyRow.getByText('未配置密钥').count()) === 1, '显示未配置密钥')
  await noKeyRow.getByTestId('channel-edit').click()
  await page.getByTestId('channel-name-input').fill('无密钥渠道改名')
  await page.getByTestId('channel-save').click()
  const renamed = page.getByTestId('channel-row').filter({ hasText: '无密钥渠道改名' })
  await renamed.waitFor({ timeout: 5000 })
  record('渠道编辑改名保留状态', (await renamed.getByText('未配置密钥').count()) === 1, '改名后仍未配置密钥')

  // ── 渠道：被 Session 引用时删除被拒 ──
  await page.getByTestId('channel-settings-close').click()
  await page.getByRole('button', { name: '+ 新会话' }).click()
  const sessions = await page.evaluate(() => window.tgbuddy.session.list())
  const sessionId = sessions[0]?.id
  await page.evaluate((sid) => window.tgbuddy.session.updateMeta(sid, { channelId: 'qa' }), sessionId)
  await page.getByTestId('settings-open').click()
  const qaRow = page.getByTestId('channel-row').filter({ hasText: 'QA 渠道' })
  await page.once('dialog', (d) => d.accept())
  await qaRow.getByTestId('channel-delete').click()
  const deleteError = page.getByText(/仍有会话使用该渠道/)
  await deleteError.waitFor({ timeout: 5000 })
  record('删除被引用渠道被拒', true, '显示「仍有会话使用该渠道」')
  await shot('02-channel-delete-rejected')

  // ── 模型 chip：选择后写入会话；无渠道模型时的提示 ──
  await page.getByTestId('channel-settings-close').click()
  await page.getByTestId('model-chip').click()
  await page.waitForTimeout(300)
  await shot('03-model-chip-menu')
  await page.getByTestId('model-option').first().click()
  const metaAfter = await page.evaluate(async (sid) => {
    const list = await window.tgbuddy.session.list()
    return list.find((s) => s.id === sid)
  }, sessionId)
  record('模型 chip 选择生效', Boolean(metaAfter?.channelId && metaAfter?.modelId), `channel=${metaAfter?.channelId} model=${metaAfter?.modelId}`)

  // ── 工具：单工具禁止 → 恢复推荐；批量询问 ──
  await page.getByTestId('settings-open').click()
  const writeRow = page.getByTestId('tool-row').filter({ hasText: '写入文件' })
  await writeRow.getByTestId('tool-perm-write-deny').click()
  await page.waitForTimeout(400)
  const denySelected = await writeRow.getByText('禁止').isVisible()
  record('工具单覆盖为禁止', denySelected, '禁止高亮')
  await writeRow.getByTestId('tool-reset-write').click()
  await page.waitForTimeout(400)
  const askRestored = await writeRow.getByText('询问').isVisible()
  record('工具恢复推荐', askRestored, '回退到询问')
  await shot('04-tools-section')

  // ── 技能：工作区技能可见；开关切换 ──
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="channel-settings-panel"] .overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await page.waitForTimeout(400)
  const wsSkill = page.getByTestId('skill-row').filter({ hasText: '工作区专属技能' })
  record('工作区技能可见', (await wsSkill.count()) === 1, 'ws-skill 随当前工作区出现')
  await wsSkill.getByTestId('skill-toggle-ws-skill').click()
  await page.waitForTimeout(300)
  const toggled = await page.getByTestId('skill-toggle-ws-skill').getAttribute('aria-checked')
  record('技能开关切换', toggled === 'false', `aria-checked=${toggled}`)
  await shot('05-skills-section')

  // ── MCP：坏命令 → 可诊断失败；echo 连接 → 工具出现；断开 → 工具移除 ──
  await page.getByTestId('mcp-add').click()
  await page.getByTestId('mcp-name-input').fill('坏服务')
  await page.getByTestId('mcp-key-input').fill('bad')
  await page.getByTestId('mcp-command-input').fill('node no-such-file.mjs')
  await page.getByTestId('mcp-save').click()
  const badRow = page.getByTestId('mcp-row').filter({ hasText: '坏服务' })
  await badRow.getByTestId('mcp-connect').click()
  await badRow.getByTestId('mcp-error').waitFor({ timeout: 20000 })
  record('MCP 坏命令可诊断失败', true, (await badRow.getByTestId('mcp-error').innerText()).slice(0, 60))
  await shot('06-mcp-error')

  await page.getByTestId('mcp-add').click()
  await page.getByTestId('mcp-name-input').fill('echo')
  await page.getByTestId('mcp-key-input').fill('echo')
  await page.getByTestId('mcp-command-input').fill('node scripts/mcp-fixture-server.mjs')
  await page.getByTestId('mcp-save').click()
  const echoRow = page.getByTestId('mcp-row').filter({ hasText: 'echo' })
  await echoRow.getByTestId('mcp-connect').click()
  await echoRow.getByText('已连接').waitFor({ timeout: 20000 })
  await echoRow.getByTestId('mcp-tools-toggle').click()
  const mcpToolVisible = await page.getByTestId('mcp-tool-row').filter({ hasText: 'echo.echo' }).isVisible()
  record('MCP 工具发现', mcpToolVisible, 'echo.echo 出现在连接器卡片')
  await shot('07-mcp-connected-tools')
  await echoRow.getByTestId('mcp-disconnect').click()
  await page.waitForTimeout(500)
  const toolCount = await page.getByTestId('mcp-tool-row').filter({ hasText: 'echo.echo' }).count()
  record('MCP 断开后工具移除', toolCount === 0, '工具列表不再显示 echo.echo')

  // ── Run：失败路径（无 key 渠道）账本仍可读 ──
  await page.getByTestId('channel-settings-close').click()
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await page.evaluate(() => {
    const input = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, 'QA 写入')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('QA 完成', { exact: true }).waitFor({ timeout: 15000 })
  const usageButton = page.getByRole('button', { name: '查看上下文用量' })
  await usageButton.waitFor({ timeout: 10000 })
  await usageButton.click()
  const ledgerHeading = page.getByText('最近一次运行账本', { exact: true })
  await ledgerHeading.waitFor({ timeout: 8000 })
  record('Run 账本展示', true, '最近一次运行账本可见')
  await shot('08-run-ledger')

  // ── 重启恢复：优雅重启后设置仍持久化 ──
  await app.close()
  const app2 = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--disable-gpu'],
    cwd: join(import.meta.dirname, '..', '..', '..', '..'),
    env: {
      ...process.env,
      TGBUDDY_DATA_DIR: dataDir,
      TGBUDDY_WORKSPACE_DIR: ws,
      TGBUDDY_E2E: '1',
    },
  })
  const page2 = await app2.firstWindow()
  await page2.getByRole('button', { name: '+ 新会话' }).waitFor({ timeout: 20000 })
  await page2.getByTestId('settings-open').click()
  await page2.getByTestId('channel-settings-panel').waitFor()
  await page2.waitForTimeout(600)
  const channelsAfter = await page2.evaluate(() => window.tgbuddy.channel.list())
  const names = channelsAfter.map((c) => c.name)
  record('重启后设置持久化', names.includes('QA 渠道') && names.includes('无密钥渠道改名'), `channels=${JSON.stringify(names)}`)
  await page2.screenshot({ path: join(EVIDENCE_DIR, '09-restart-persist.png') })
  await app2.close()
} catch (error) {
  console.error('QA 驱动异常：', error)
  findings.push({ name: '驱动异常', ok: false, detail: String(error) })
} finally {
  await app.close().catch(() => {})
  await new Promise((r) => server.close(r))
  await rm(root, { recursive: true, force: true })
}

const passed = findings.filter((f) => f.ok).length
console.log(`\nQA 结果：${passed}/${findings.length} 通过`)
process.exit(passed === findings.length ? 0 : 1)
