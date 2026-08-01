import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

test('UI：会话悬停显示置顶、删除、归档三个图标操作', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await page.getByRole('button', { name: '+ 新会话' }).click()

  const first = page.getByTestId('session-item').first()
  await first.hover()
  const actions = page.locator('[data-testid^="session-actions-"]').first()
  await expect(actions).toBeVisible()
  await expect(page.locator('[data-testid^="session-menu-"]')).toHaveCount(0)
  await expect(actions.getByRole('button')).toHaveCount(3)

  await actions.getByRole('button', { name: '置顶', exact: true }).click()
  await expect(page.getByText('置顶', { exact: true })).toBeVisible()

  const pinned = page.getByTestId('session-item').first()
  await pinned.hover()
  await page.locator('[data-testid^="session-actions-"]').first().getByRole('button', { name: '归档', exact: true }).click()
  await expect(page.getByTestId('session-item')).toHaveCount(1)

  await page.getByTestId('session-item').first().hover()
  await page.locator('[data-testid^="session-actions-"]').first().getByRole('button', { name: '删除会话', exact: true }).click()
  const deleteDialog = page.getByRole('dialog', { name: '删除会话' })
  await deleteDialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByTestId('session-item')).toHaveCount(0)
})

test('UI：悬停会话显示 Codex 式工作区预览', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await page.getByRole('button', { name: '+ 新会话' }).click()

  await page.getByTestId('session-item').first().hover()
  const preview = page.getByTestId('session-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('未开始')
  await expect(preview).toContainText(/default|proma-mini/)

  await page.getByTestId('session-search').hover()
  await expect(preview).toHaveCount(0)
})

test('UI：三种导航都保护草稿，留下不动、丢弃后只执行一次', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  const workspacePath = await mkdtemp(join(tmpdir(), 'tgbuddy-draft-nav-'))
  try {
    await page.evaluate(async (path) => {
      await window.tgbuddy.workspace.create({ path })
    }, workspacePath)
    await page.reload()
    await page.getByRole('button', { name: '+ 新会话' }).click()
    const input = page.getByPlaceholder(/给 Agent 下达任务/)

    // new-session：Stay 不变；Discard 清空并只新增一个会话。
    await input.fill('新建前草稿')
    const beforeNew = await page.getByTestId('session-item').count()
    await page.keyboard.press('Control+N')
    await page.getByRole('dialog', { name: '保留未发送内容' }).getByRole('button', { name: '留下', exact: true }).click()
    await expect(input).toHaveValue('新建前草稿')
    expect(await page.getByTestId('session-item').count()).toBe(beforeNew)
    await page.keyboard.press('Control+N')
    await page.getByRole('dialog', { name: '保留未发送内容' }).getByRole('button', { name: '丢弃并继续', exact: true }).click()
    await expect(input).toHaveValue('')
    await expect(page.getByTestId('session-item')).toHaveCount(beforeNew + 1)

    // switch-session：Stay 保持当前标题；Discard 后切换到目标。
    const items = page.getByTestId('session-item')
    const currentItem = page.locator('[data-testid="session-item"][aria-current="true"]')
    const currentSessionId = await currentItem.getAttribute('data-session-id')
    const target = items.nth(1)
    await input.fill('切会话前草稿')
    await target.click()
    await page.getByRole('dialog', { name: '保留未发送内容' }).getByRole('button', { name: '留下', exact: true }).click()
    await expect(page.locator('[data-testid="session-item"][aria-current="true"]')).toHaveAttribute('data-session-id', currentSessionId ?? '')
    await target.click()
    await page.getByRole('dialog', { name: '保留未发送内容' }).getByRole('button', { name: '丢弃并继续', exact: true }).click()
    await expect(input).toHaveValue('')
    await expect(target).toHaveAttribute('aria-current', 'true')

    // switch-workspace：同样先 Stay，再 Discard。
    const originalPath = await page.evaluate(async () => (await window.tgbuddy.workspace.current())?.mount?.path)
    await input.fill('切工作区前草稿')
    await page.getByTestId('workspace-picker').click()
    await page.getByTestId('workspace-option').filter({ hasText: workspacePath }).click()
    await page.getByRole('dialog', { name: '保留未发送内容' }).getByRole('button', { name: '留下', exact: true }).click()
    await expect(page.getByTestId('workspace-picker')).toContainText(originalPath ?? '')
    await page.getByTestId('workspace-picker').click()
    await page.getByTestId('workspace-option').filter({ hasText: workspacePath }).click()
    await page.getByRole('dialog', { name: '保留未发送内容' }).getByRole('button', { name: '丢弃并继续', exact: true }).click()
    await expect(page.getByTestId('workspace-picker')).toContainText(workspacePath)
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
