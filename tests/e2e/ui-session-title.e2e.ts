import { expect, test } from './support/electron-fixture'

test('UI：首条消息后异步生成标题并在重启后恢复', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await page.getByRole('button', { name: '+ 新会话' }).click()

  const input = page.getByPlaceholder(/给 Agent 下达任务/)
  await input.fill('请分析 Q2 交易异常风险')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText(/E2E 回复/)).toBeVisible()
  await expect(page.getByTestId('conversation-title')).toHaveText('Q2 交易异常分析')
  await expect(page.getByTestId('session-item').first()).toContainText('Q2 交易异常分析')

  await tgbuddy.restart()
  await expect(tgbuddy.page.getByTestId('session-item').first()).toContainText('Q2 交易异常分析')
})
