import type { Page } from '@playwright/test'
import { expect, test } from './support/electron-fixture'

async function createSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await expect(page.getByPlaceholder(/说点什么/)).toBeEnabled()
}

async function sendAndWait(
  page: Page,
  prompt: string,
  expectedReply: string | RegExp,
): Promise<void> {
  const input = page.getByPlaceholder(/说点什么/)
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText(expectedReply, { exact: typeof expectedReply === 'string' }))
    .toBeVisible()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
}

async function selectOnlySession(page: Page): Promise<void> {
  await page.getByTestId('session-item').click()
}

test('会话流式结果可持久化，硬重启会恢复中断 Run 并可继续', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await sendAndWait(tgbuddy.page, '你好 E2E', 'E2E 回复：你好 E2E')

  await tgbuddy.restart()
  await selectOnlySession(tgbuddy.page)
  await expect(tgbuddy.page.getByText('你好 E2E', { exact: true })).toBeVisible()
  await expect(tgbuddy.page.getByText('E2E 回复：你好 E2E', { exact: true })).toBeVisible()

  await tgbuddy.page.getByPlaceholder(/说点什么/).fill('慢速恢复')
  await tgbuddy.page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(tgbuddy.page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  await tgbuddy.restart({ hard: true })

  await selectOnlySession(tgbuddy.page)
  await expect(tgbuddy.page.getByText(/应用上次退出时任务仍在运行/)).toBeVisible()
  await sendAndWait(tgbuddy.page, '恢复后继续', 'E2E 回复：恢复后继续')
})

test('停止会中止 Run、丢弃迟到文本，并允许下一次发送', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  const input = tgbuddy.page.getByPlaceholder(/说点什么/)
  await input.fill('慢速停止')
  await tgbuddy.page.getByRole('button', { name: '发送', exact: true }).click()
  await tgbuddy.page.getByRole('button', { name: '停止', exact: true }).click()

  await expect(tgbuddy.page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
  await expect(
    tgbuddy.page.getByRole('button', { name: /已中断 · 用户已停止/ }),
  ).toBeVisible()
  await expect(tgbuddy.page.getByText('这段迟到文本不应在停止后出现')).toHaveCount(0)
  await sendAndWait(tgbuddy.page, '停止后继续', 'E2E 回复：停止后继续')
})

test('工具调用成功态与输出可在重启后回放', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await sendAndWait(tgbuddy.page, '请工具读取 README.md', '工具读取完成')

  const tool = tgbuddy.page.getByRole('button', { name: /read.*读取 README\.md/ })
  await expect(tool).toBeVisible()
  await tool.click()
  await expect(tgbuddy.page.getByText(/E2E_WORKSPACE_CONTENT/)).toBeVisible()

  await tgbuddy.restart()
  await selectOnlySession(tgbuddy.page)
  await expect(tgbuddy.page.getByRole('button', { name: /read.*读取 README\.md/ })).toBeVisible()
  await expect(tgbuddy.page.getByText('工具读取完成', { exact: true })).toBeVisible()
})

test('达到阈值会自动压缩，并在压缩后发送排队消息', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  for (const index of [1, 2, 3]) {
    await sendAndWait(
      tgbuddy.page,
      `压缩素材 ${index}`,
      `压缩素材完成：压缩素材 ${index}`,
    )
  }
  const input = tgbuddy.page.getByPlaceholder(/说点什么/)
  await input.fill('触发自动压缩')
  await tgbuddy.page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(tgbuddy.page.getByText('E2E 回复：触发自动压缩', { exact: true }))
    .toBeVisible()
  await expect(tgbuddy.page.getByText(/上下文接近上限，\d 秒后自动压缩/)).toBeVisible()
  await input.fill('排队消息')
  await tgbuddy.page.getByRole('button', { name: '排队', exact: true }).click()
  await expect(tgbuddy.page.getByText('已排队，压缩完成后自动发送')).toBeVisible()
  await expect(tgbuddy.page.getByText('排队消息已在压缩后执行', { exact: true }))
    .toBeVisible({ timeout: 20_000 })

  const divider = tgbuddy.page.getByRole('button', { name: /已压缩 \d+ 条消息/ })
  await expect(divider).toBeVisible()
  await divider.click()
  await expect(tgbuddy.page.getByText(/E2E 压缩摘要/)).toBeVisible()
  await tgbuddy.page.getByRole('button', { name: /查看原始 \d+ 条消息/ }).click()
  await expect(tgbuddy.page.getByText(/用户：压缩素材 1/)).toBeVisible()
})

test('编辑重发截断旧后缀，从此新建会话保持扁平且互不影响', async ({ tgbuddy }) => {
  await createSession(tgbuddy.page)
  await sendAndWait(tgbuddy.page, '第一版', 'E2E 回复：第一版')
  await sendAndWait(tgbuddy.page, '第二轮', 'E2E 回复：第二轮')

  const firstMessage = tgbuddy.page.getByText('第一版', { exact: true }).locator('..')
  await firstMessage.getByRole('button', { name: '编辑并重发' }).click()
  const editor = tgbuddy.page.getByRole('textbox', { name: '编辑消息' })
  await editor.fill('第一版（修订）')
  await tgbuddy.page.getByRole('button', { name: '重发', exact: true }).click()
  await expect(tgbuddy.page.getByText('E2E 回复：第一版（修订）', { exact: true })).toBeVisible()
  await expect(tgbuddy.page.getByText('第二轮', { exact: true })).toHaveCount(0)

  const revisedMessage = tgbuddy.page
    .getByText('第一版（修订）', { exact: true })
    .locator('..')
  await revisedMessage.getByRole('button', { name: '从此新建会话' }).click()
  await expect(tgbuddy.page.getByTestId('session-item')).toHaveCount(2)
  await sendAndWait(tgbuddy.page, '克隆继续', 'E2E 回复：克隆继续')

  await tgbuddy.page.getByTestId('session-item').last().click()
  await expect(tgbuddy.page.getByText('E2E 回复：第一版（修订）', { exact: true })).toBeVisible()
  await expect(tgbuddy.page.getByText('克隆继续', { exact: true })).toHaveCount(0)
})
