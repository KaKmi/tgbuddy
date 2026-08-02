import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

const EVIDENCE_DIR = join(
  process.cwd(),
  '.ship',
  'tasks',
  'permission-subagent-ui-ux',
  'e2e',
  'artifacts',
)

async function createSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await expect(page.getByPlaceholder(/给 Agent 下达任务/)).toBeEnabled()
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder(/给 Agent 下达任务/)
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('两个具名子 Agent 返回具体结果，Main Agent 综合后可在任务工作台回看', async ({ tgbuddy }) => {
  const page = tgbuddy.page
  await mkdir(EVIDENCE_DIR, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await createSession(page)
  await send(page, 'E2E 双委托')

  await expect(page.getByText('主 Agent 综合完成：', { exact: false })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('架构侦察员', { exact: true })).toBeVisible()
  await expect(page.getByText('测试侦察员', { exact: true })).toBeVisible()
  await expect(page.getByTestId('session-item')).toHaveCount(1)
  await page.screenshot({ path: join(EVIDENCE_DIR, '01-delegation-cards.png'), fullPage: true })

  await page.getByRole('button', { name: '切换到深色主题' }).click()
  const firstDelegation = page.getByTestId('delegation-tool-card').first()
  await firstDelegation.getByRole('button').first().click()
  await expect(firstDelegation.getByText('任务', { exact: true })).toBeVisible()
  await expect(firstDelegation.getByText('结果', { exact: true })).toBeVisible()
  await expect(firstDelegation).not.toContainText('"task":')
  await page.screenshot({ path: join(EVIDENCE_DIR, '01b-delegation-expanded-dark.png'), fullPage: true })
  await firstDelegation.getByRole('button').first().click()

  await page.getByRole('button', { name: /子智能体/ }).click()
  await expect(page.getByTestId('task-list')).toBeVisible()
  await expect(page.getByTestId('results-section-count')).toHaveText('2 项')
  await expect(page.getByText('架构侦察员', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('测试侦察员', { exact: true }).last()).toBeVisible()
  await page.screenshot({ path: join(EVIDENCE_DIR, '02-task-workbench.png'), fullPage: true })

  await page.getByText('架构侦察员', { exact: true }).last().click()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await expect(page.getByText(/架构证据：Runtime、IPC、Renderer/)).toBeVisible()
  await expect(page.getByTestId('task-detail')).not.toContainText('"kind": "kernel"')
  await page.screenshot({ path: join(EVIDENCE_DIR, '03-task-detail.png'), fullPage: true })
})
