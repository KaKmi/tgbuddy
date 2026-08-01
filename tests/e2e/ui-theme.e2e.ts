import { expect, test } from './support/electron-fixture'

test('UI：fresh 启动为明亮主题，切换后重启仍保持深色', async ({ tgbuddy }) => {
  const initialPage = tgbuddy.page
  await expect(initialPage.locator('html')).toHaveAttribute('data-theme', 'light')

  await initialPage.getByRole('button', { name: '切换到深色主题' }).click()
  await expect(initialPage.locator('html')).toHaveAttribute('data-theme', 'dark')

  await tgbuddy.restart()
  const restartedPage = tgbuddy.page
  await expect(restartedPage.locator('html')).toHaveAttribute('data-theme', 'dark')

  await restartedPage.getByRole('button', { name: '切换到明亮主题' }).click()
  await expect(restartedPage.locator('html')).toHaveAttribute('data-theme', 'light')
})
