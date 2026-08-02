import type { Page } from '@playwright/test'
import { expect, test } from './support/electron-fixture'

async function createSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await expect(page.getByPlaceholder(/给 Agent 下达任务/)).toBeEnabled()
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder(/给 Agent 下达任务/)
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
  await expect(tgbuddy.page.getByText('计划已准备好')).toBeVisible()
  await expect(tgbuddy.page.getByText('修改 m2-write.txt')).toBeVisible()

  await tgbuddy.page.getByRole('button', { name: '批准并执行', exact: true }).click()
  await expect(tgbuddy.page.getByText('M2 计划完成', { exact: true })).toBeVisible()
  // 批准后保留计划模式，仅允许执行本次获批计划内的效果。
  await expect(tgbuddy.page.getByRole('button', { name: '计划模式', exact: true })).toBeVisible()
})

test('计划模式下写操作被拒绝并给出原因，切回默认权限后恢复', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await switchMode(tgbuddy.page, '默认权限', '计划模式')

  await send(tgbuddy.page, 'M2 写入')
  await expect(tgbuddy.page.getByText('计划模式下不允许执行该操作')).toBeVisible()
  await expect(tgbuddy.page.getByRole('button', { name: '发送', exact: true })).toBeVisible()

  await switchMode(tgbuddy.page, '计划模式', '默认权限')
  await send(tgbuddy.page, 'M2 写入')
  await expect(tgbuddy.page.getByTestId('action-dock')).toContainText('允许执行 write？')
  await tgbuddy.page.getByRole('button', { name: '允许一次', exact: true }).click()
  // 计划模式下的写被拒也会让 fake server 回一条完成文本，历史里会有多条，取最后一条
  await expect(
    tgbuddy.page.getByText('M2 写入完成', { exact: true }).last(),
  ).toBeVisible()
})

test('ask_user 结构化问题可回答并回到原任务', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await send(tgbuddy.page, 'M2 提问')

  await expect(tgbuddy.page.getByText('这次修改的目标是什么？')).toBeVisible()
  await tgbuddy.page.getByRole('button', { name: /修 bug/ }).click()
  await tgbuddy.page.getByRole('button', { name: '下一个', exact: true }).click()
  await expect(tgbuddy.page.getByText('影响范围？')).toBeVisible()
  await tgbuddy.page.getByRole('button', { name: /单文件/ }).click()
  await expect(
    tgbuddy.page.getByRole('button', { name: '提交回答', exact: true }),
  ).toBeEnabled()
  await tgbuddy.page.getByRole('button', { name: '提交回答', exact: true }).click()

  await expect(tgbuddy.page.getByText('M2 提问完成', { exact: true })).toBeVisible()
})
