import { expect, test } from './support/electron-fixture'

test('UI：结果区覆盖层与侧栏断点没有横向溢出', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await page.getByRole('button', { name: '+ 新会话' }).click()

  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(page.getByTestId('results-panel')).toBeVisible()
  await expect(page.getByTestId('results-backdrop')).toBeHidden()
  expect(await page.getByTestId('app-sidebar').evaluate((node) => node.getBoundingClientRect().width)).toBe(252)

  await page.setViewportSize({ width: 1180, height: 900 })
  await expect(page.getByTestId('results-backdrop')).toBeVisible()
  await expect(page.getByTestId('results-panel')).toHaveCSS('position', 'fixed')
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await page.getByTestId('results-backdrop').click({ position: { x: 10, y: 10 } })
  await expect(page.getByTestId('results-panel')).toBeHidden()
  await expect(page.getByTestId('results-toggle')).toBeFocused()

  await page.getByTestId('results-toggle').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('results-panel')).toBeHidden()
  await expect(page.getByTestId('results-toggle')).toBeFocused()

  await page.setViewportSize({ width: 820, height: 900 })
  expect(await page.getByTestId('app-sidebar').evaluate((node) => node.getBoundingClientRect().width)).toBe(218)
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await page.setViewportSize({ width: 640, height: 900 })
  await expect(page.getByTestId('app-sidebar')).toBeHidden()
  await expect(page.getByTestId('results-toggle')).toBeVisible()
  await page.getByTestId('results-toggle').click()
  const resultWidth = await page.getByTestId('results-panel').evaluate((node) => node.getBoundingClientRect().width)
  expect(resultWidth).toBeLessThanOrEqual(640 * 0.92 + 1)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}
