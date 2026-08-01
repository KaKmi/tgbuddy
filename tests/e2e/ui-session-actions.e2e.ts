import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

test('UI：会话菜单使用产品内重命名/删除，并支持 Escape 返回焦点', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await page.getByRole('button', { name: '+ 新会话' }).click()

  const menu = page.locator('[data-testid^="session-menu-"]').first()
  await menu.click()
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()

  await menu.click()
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const renameDialog = page.getByRole('dialog', { name: '重命名会话' })
  await renameDialog.getByRole('textbox').fill('新的会话名称')
  await renameDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('新的会话名称', { exact: true }).first()).toBeVisible()

  await page.locator('[data-testid^="session-menu-"]').first().click()
  await page.getByRole('menuitem', { name: '删除会话', exact: true }).click()
  const deleteDialog = page.getByRole('dialog', { name: '删除会话' })
  await deleteDialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByTestId('session-item')).toHaveCount(0)
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
    const input = page.getByPlaceholder(/说点什么/)

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
