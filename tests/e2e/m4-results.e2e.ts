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

test('M4：附件选择 → chip → 发送后消息回显附件', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await createSession(page)

  // 选择文件（隐藏 input），stage 到 BlobStore 后显示输入区 chip
  await page.setInputFiles('input[data-testid="attachment-input"]', {
    name: '需求.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 需求\n请实现这个功能', 'utf8'),
  })
  await expect(page.getByText('需求.md')).toBeVisible()

  await send(page, '处理附件')
  await expect(page.getByText(/E2E 回复/)).toBeVisible()
  // 用户消息回显附件 chip（KernelMessage.attachments），输入区 chip 已清空
  await expect(page.getByTestId('attachment-chip')).toBeVisible()
  await expect(page.getByTestId('attachment-chip')).toHaveCount(1)
})

test('M4：write 产物出现在结果区，可预览并用系统打开', async ({ tgbuddy }, testInfo) => {
  const page = tgbuddy.page
  await createSession(page)
  await send(page, 'M2 写入')

  await page.getByText('请求执行 write').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '允许', exact: true }).click()
  await page.getByText('M2 写入完成', { exact: true }).last().waitFor({ timeout: 15000 })

  // 结果区出现产物
  const item = page.getByTestId('result-item').filter({ hasText: 'm2-write.txt' })
  await expect(item).toBeVisible()
  await item.click()

  await expect(page.getByTestId('artifact-preview-card')).toBeVisible()
  await expect(page.getByTestId('artifact-open')).toBeVisible()
  await expect(page.getByText('让 Agent 改这份', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('results-panel.png') })
})
