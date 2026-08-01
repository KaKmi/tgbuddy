import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

const QA_DIRECTORY = join(process.cwd(), '.ship', 'tasks', 'settings-center', 'qa')

test('设置中心按 V3 原型提供完整导航与管理入口', async ({ tgbuddy }) => {
  mkdirSync(QA_DIRECTORY, { recursive: true })
  const page = tgbuddy.page
  await page.getByTestId('settings-open').click()

  const settings = page.getByTestId('channel-settings-panel')
  await expect(settings).toBeVisible()
  await expect(page.getByTestId('settings-tab-general')).toBeVisible()
  await expect(page.getByTestId('settings-tab-models')).toBeVisible()
  await expect(page.getByTestId('settings-tab-permissions')).toBeVisible()
  await expect(page.getByTestId('settings-tab-capabilities')).toBeVisible()
  await expect(page.getByTestId('settings-tab-appearance')).toBeVisible()
  await page.screenshot({ path: join(QA_DIRECTORY, 'settings-general.png') })

  await page.getByTestId('settings-tab-models').click()
  await expect(page.getByTestId('settings-tab-models')).toHaveClass(/active/)
  await expect(page.getByTestId('settings-tab-general')).not.toHaveClass(/active/)
  await expect(page.getByText('Provider 与密钥', { exact: true })).toBeVisible()
  await expect(page.getByTestId('channel-add')).toBeVisible()
  await page.screenshot({ path: join(QA_DIRECTORY, 'settings-models.png') })

  await page.getByTestId('settings-tab-capabilities').click()
  await page.getByTestId('capability-skill').getByRole('button', { name: '管理' }).click()
  await expect(page.getByPlaceholder('搜索技能')).toBeVisible()
})
