import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

test('UI：侧栏展示品牌、本地状态和真实 Workspace 信息', async ({ tgbuddy }) => {
  const page = tgbuddy.page

  await expect(page.getByTestId('app-brand')).toContainText('TgBuddy')
  await expect(page.getByTestId('local-mode')).toContainText('本地模式')
  await expect(page.getByTestId('settings-open')).toBeVisible()
  await expect(page.getByRole('button', { name: /切换到.*主题/ })).toBeVisible()

  const currentPath = await page.evaluate(async () => {
    const workspace = await window.tgbuddy.workspace.current()
    return workspace?.mount?.path ?? ''
  })
  await expect(page.getByTestId('workspace-picker')).toContainText(currentPath)

  await page.getByTestId('workspace-picker').click()
  await expect(page.getByTestId('workspace-add')).toBeVisible()
})

test('UI：Workspace 目录丢失时在选择器内给出恢复提示', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  const workspacePath = await mkdtemp(join(tmpdir(), 'tgbuddy-sidebar-missing-'))
  try {
    await page.evaluate(async (path) => {
      const workspace = await window.tgbuddy.workspace.create({ path })
      await window.tgbuddy.workspace.select(workspace.id)
    }, workspacePath)
    await rm(workspacePath, { recursive: true, force: true })
    await page.reload()

    await expect(page.getByTestId('workspace-mount-error')).toContainText('目录不可用')
    await expect(page.getByTestId('workspace-picker')).toContainText('重新选择')
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
