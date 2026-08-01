import { expect, test } from './support/electron-fixture'

test('UI：三栏骨架、会话标题与结果区开关保持轻量一致', async ({ tgbuddy }) => {
  const page = tgbuddy.page

  await page.getByRole('button', { name: '+ 新会话' }).click()

  const shell = page.getByTestId('app-shell')
  const toolbar = page.getByTestId('window-toolbar')
  const sidebar = page.getByTestId('app-sidebar')
  const header = page.getByTestId('conversation-header')
  const title = page.getByTestId('conversation-title')
  const results = page.getByTestId('results-panel')
  const toggle = page.getByTestId('results-toggle')

  await expect(shell).toBeVisible()
  await expect(toolbar).toBeVisible()
  await expect(page.getByRole('button', { name: '最小化' })).toBeVisible()
  expect(await toolbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(36)
  await expect(header).toBeVisible()
  await expect(title).not.toHaveText('')
  await expect(results).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(252)
  expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(48)
  expect(await results.evaluate((element) => element.getBoundingClientRect().width)).toBe(396)

  await toggle.click()
  await expect(results).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await toggle.click()
  await expect(results).toBeVisible()

  const input = page.getByPlaceholder(/给 Agent 下达任务/)
  await input.fill('M2 写入')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('请求执行 write')).toBeVisible()
  await expect(page.getByTestId('run-pill')).toBeVisible()
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
})
