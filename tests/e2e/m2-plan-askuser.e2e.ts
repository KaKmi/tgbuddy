import type { Page } from '@playwright/test'
import { expect, test } from './support/electron-fixture'

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
  // 模式 chip 的可访问名就是当前模式标签；菜单项同名，先点 chip 再点目标项。
  await page.getByRole('button', { name: from, exact: true }).first().click()
  await page.getByRole('button', { name: new RegExp(`^${to}\\s`) }).click()
}

test('计划模式完整闭环：进入调研 → 提交计划 → 批准后执行', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await send(tgbuddy.page, 'M2 计划')

  // enter_plan_mode 执行后模式变为计划
  await expect(tgbuddy.page.getByRole('button', { name: '计划模式', exact: true })).toBeVisible()
  // exit_plan_mode 提交计划 → 审批卡
  await expect(tgbuddy.page.getByText('计划待审批')).toBeVisible()
  await expect(tgbuddy.page.getByText('修改 m2-write.txt')).toBeVisible()

  await tgbuddy.page.getByRole('button', { name: '批准并执行', exact: true }).click()
  await expect(tgbuddy.page.getByText('M2 计划完成', { exact: true })).toBeVisible()
  // 批准后退出计划模式
  await expect(tgbuddy.page.getByRole('button', { name: '默认权限', exact: true })).toBeVisible()
})

test('计划模式下写操作被拒绝并给出原因，切回默认权限后恢复', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await switchMode(tgbuddy.page, '默认权限', '计划模式')

  await send(tgbuddy.page, 'M2 写入')
  await expect(tgbuddy.page.getByText(/计划模式下不允许执行写操作/)).toBeVisible()
  await expect(tgbuddy.page.getByRole('button', { name: '发送', exact: true })).toBeVisible()

  await switchMode(tgbuddy.page, '计划模式', '默认权限')
  await send(tgbuddy.page, 'M2 写入')
  await expect(tgbuddy.page.getByText('请求执行 write')).toBeVisible()
  await tgbuddy.page.getByRole('button', { name: '允许', exact: true }).click()
  await expect(tgbuddy.page.getByText('M2 写入完成', { exact: true })).toBeVisible()
})

test('ask_user 结构化问题可回答并回到原任务', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await send(tgbuddy.page, 'M2 提问')

  await expect(tgbuddy.page.getByText('需要你的补充')).toBeVisible()
  await expect(tgbuddy.page.getByText('这次修改的目标是什么？')).toBeVisible()
  await expect(tgbuddy.page.getByText('影响范围？')).toBeVisible()

  await tgbuddy.page
    .locator('fieldset')
    .nth(0)
    .getByPlaceholder('其他答案…')
    .fill('修 bug')
  await tgbuddy.page
    .locator('fieldset')
    .nth(1)
    .getByPlaceholder('其他答案…')
    .fill('单文件')
  await tgbuddy.page.getByRole('button', { name: '提交回答', exact: true }).click()

  await expect(tgbuddy.page.getByText('M2 提问完成', { exact: true })).toBeVisible()
})
