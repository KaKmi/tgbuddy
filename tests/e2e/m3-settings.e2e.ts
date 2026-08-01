import type { Page } from '@playwright/test'
import { expect, test } from './support/electron-fixture'

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('channel-settings-panel')).toBeVisible()
}

async function openSettingsTab(
  page: Page,
  tab: 'models' | 'permissions' | 'capabilities' | 'appearance',
): Promise<void> {
  await openSettings(page)
  await page.getByTestId(`settings-tab-${tab}`).click()
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId('channel-settings-close').click()
  await expect(page.getByTestId('channel-settings-panel')).toHaveCount(0)
}

async function createSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await expect(page.getByPlaceholder(/说点什么/)).toBeEnabled()
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder(/说点什么/)
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

async function switchMode(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: from, exact: true }).first().click()
  await page.getByRole('button', { name: new RegExp(`^${to}\\s`) }).click()
}

test('C02：设置页渠道 CRUD，密钥只存 ref 不回传明文', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await openSettingsTab(page, 'models')

  await page.getByTestId('channel-add').click()
  await page.getByTestId('channel-name-input').fill('测试中转')
  await page.getByTestId('channel-base-url-input').fill('https://gateway.example.com/v1')
  await page.getByTestId('channel-key-input').fill('sk-e2e-top-secret')
  await page.getByTestId('channel-save').click()

  const row = page.getByTestId('channel-row').filter({ hasText: '测试中转' })
  await expect(row).toBeVisible()
  await expect(row.getByText('已配置密钥')).toBeVisible()

  // 列表结果永不含明文，只有 secret ref 状态
  const listed = await page.evaluate(() => window.tgbuddy.channel.list())
  const saved = listed.find((channel) => channel.name === '测试中转')
  expect(saved?.apiKey).toBeUndefined()
  expect(listed.some((channel) => JSON.stringify(channel).includes('sk-e2e-top-secret'))).toBe(false)

  await page.once('dialog', (dialog) => dialog.accept())
  await row.getByTestId('channel-delete').click()
  await expect(page.getByTestId('channel-row').filter({ hasText: '测试中转' })).toHaveCount(0)
})

test('C03：测试连接成功并应用发现的模型', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await openSettingsTab(page, 'models')

  const row = page.getByTestId('channel-row').filter({ hasText: 'E2E 本地模型' })
  await expect(row).toBeVisible()
  await row.getByTestId('channel-test').click()
  await expect(page.getByTestId('channel-test-result')).toContainText('连接成功')
  await expect(page.getByTestId('channel-test-result')).toContainText('1 个模型')
})

test('C04：输入区模型 chip 选择写入会话元数据', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await createSession(page)

  await expect(page.getByTestId('model-chip')).toContainText('E2E Model')
  await page.getByTestId('model-chip').click()
  await page.getByTestId('model-option').first().click()

  const sessions = await page.evaluate(() => window.tgbuddy.session.list())
  expect(sessions[0]?.channelId).toBeTruthy()
  expect(sessions[0]?.modelId).toBeTruthy()
})

test('工具区已从设置页移除；完全访问放行写操作、默认权限询问', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await openSettings(page)

  // 内置工具区已从设置页移除（MCP 服务卡里的工具列表保留）
  await expect(page.getByTestId('tool-row')).toHaveCount(0)
  await closeSettings(page)

  await createSession(page)
  // 完全访问 = 全部放行：写操作直接执行，不再询问
  await switchMode(page, '默认权限', '完全访问')
  await send(page, 'M2 写入')
  await expect(page.getByText('M2 写入完成', { exact: true })).toBeVisible()

  // 切回默认权限：写操作恢复逐次询问
  await switchMode(page, '完全访问', '默认权限')
  await send(page, 'M2 写入')
  await expect(page.getByText('请求执行 write')).toBeVisible()
})

test('C07：内置技能出现在设置列表并可切换开关', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await openSettingsTab(page, 'capabilities')
  await page.getByTestId('capability-skill').getByRole('button', { name: '管理' }).click()

  const skillRow = page.getByTestId('skill-row').filter({ hasText: '监管口径核对' })
  await expect(skillRow).toBeVisible()
  const toggle = page.getByTestId('skill-toggle-reg-check')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(page.getByTestId('skill-toggle-reg-check')).toHaveAttribute('aria-checked', 'false')

  // 计划模式已 skill 化：内置计划技能出现在设置列表
  await expect(
    page.getByTestId('skill-row').filter({ hasText: 'plan-mode' }),
  ).toBeVisible()
})

test('C09/C10/C11：MCP 连接、工具发现与真实调用闭环', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await openSettingsTab(page, 'capabilities')
  await page.getByTestId('capability-mcp').getByRole('button', { name: '管理' }).click()

  await page.getByTestId('mcp-add').click()
  await page.getByTestId('mcp-name-input').fill('echo')
  await page.getByTestId('mcp-key-input').fill('echo')
  await page.getByTestId('mcp-command-input').fill('node scripts/mcp-fixture-server.mjs')
  await page.getByTestId('mcp-save').click()

  const row = page.getByTestId('mcp-row').filter({ hasText: 'echo' })
  await expect(row).toBeVisible()
  await row.getByTestId('mcp-connect').click()
  await expect(row.getByText('已连接')).toBeVisible()

  await row.getByTestId('mcp-tools-toggle').click()
  await expect(page.getByTestId('mcp-tool-row').filter({ hasText: 'echo.echo' })).toBeVisible()
  await closeSettings(page)

  await createSession(page)
  await send(page, 'M3 MCP')
  await expect(page.getByText('请求执行 echo.echo')).toBeVisible()
  await page.getByRole('button', { name: '允许', exact: true }).click()
  // 真实工具卡出现且无失败/已拒绝徽标；模型收到回显后完成回复
  const toolCard = page.getByRole('button', { name: /echo\.echo/ }).first()
  await expect(toolCard).toBeVisible()
  await expect(toolCard.getByText(/失败|已拒绝/)).toHaveCount(0)
  await expect(page.getByText('M3 MCP 完成', { exact: true })).toBeVisible()
})

test('C12：Run 结束后上下文面板展示最近一次运行账本', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await createSession(page)
  await send(page, 'M3 账本')
  await expect(page.getByText(/E2E 回复：M3 账本/)).toBeVisible()

  await page.getByRole('button', { name: '查看上下文用量' }).click()
  await expect(page.getByText('最近一次运行账本', { exact: true })).toBeVisible()
  await expect(page.getByText(/\$\d+\.\d{4}/).first()).toBeVisible()
})
