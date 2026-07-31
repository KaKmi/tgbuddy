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
  // 计划模式由用户模式 chip 显式进入（技能承载规划流程）
  await switchMode(tgbuddy.page, '默认权限', '计划模式')
  await send(tgbuddy.page, 'M2 计划')

  // 计划模式下模型调研后提交计划 → 审批卡
  await expect(tgbuddy.page.getByRole('button', { name: '计划模式', exact: true })).toBeVisible()
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
  // 计划模式下的写被拒也会让 fake server 回一条完成文本，历史里会有多条，取最后一条
  await expect(
    tgbuddy.page.getByText('M2 写入完成', { exact: true }).last(),
  ).toBeVisible()
})

test('ask_user 结构化问题可回答并回到原任务', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await send(tgbuddy.page, 'M2 提问')

  await expect(tgbuddy.page.getByText('需要你的补充')).toBeVisible()
  await expect(tgbuddy.page.getByText('这次修改的目标是什么？')).toBeVisible()
  await expect(tgbuddy.page.getByText('影响范围？')).toBeVisible()

  // 第一题直接点选选项（修 bug），选中后不依赖「其他答案」输入框即可提交
  await tgbuddy.page
    .locator('fieldset')
    .nth(0)
    .getByRole('radio')
    .first()
    .check()
  await tgbuddy.page
    .locator('fieldset')
    .nth(1)
    .getByPlaceholder('其他答案…')
    .fill('单文件')
  await expect(
    tgbuddy.page.getByRole('button', { name: '提交回答', exact: true }),
  ).toBeEnabled()
  await tgbuddy.page.getByRole('button', { name: '提交回答', exact: true }).click()

  await expect(tgbuddy.page.getByText('M2 提问完成', { exact: true })).toBeVisible()
})
