import type { Page } from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

async function createSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await expect(page.getByPlaceholder(/给 Agent 下达任务/)).toBeEnabled()
}

async function sendAndWait(
  page: Page,
  prompt: string,
  expectedReply: string | RegExp,
): Promise<void> {
  const input = page.getByPlaceholder(/给 Agent 下达任务/)
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText(expectedReply, { exact: typeof expectedReply === 'string' }))
    .toBeVisible()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
}

async function workspaceName(page: Page, index: number): Promise<string> {
  const path = await page.evaluate((i) => {
    const workspaces = window.tgbuddy.workspace
    return workspaces
      .list()
      .then((list) => list[i]?.name ?? '')
  }, index)
  return path
}

/** 通过 preload IPC 添加工作区（原生目录对话框无法自动化），随后刷新让 UI 镜像 */
async function addWorkspace(page: Page, path: string): Promise<void> {
  await page.evaluate(async (workspacePath) => {
    const created = await window.tgbuddy.workspace.create({ path: workspacePath })
    await window.tgbuddy.workspace.select(created.id)
  }, path)
  await page.reload()
  await expect(page.getByTestId('workspace-picker')).toBeVisible()
}

async function switchWorkspace(page: Page, name: string): Promise<void> {
  await page.getByTestId('workspace-picker').click()
  await page
    .getByTestId('workspace-option')
    .filter({ hasText: name })
    .click()
}

test('工作区切换隔离会话：A 的会话在 B 不可见，切回 A 恢复', async ({ tgbuddy }) => {
  const workspaceA = await mkdtemp(join(tmpdir(), 'tgbuddy-e2e-ws-a-'))
  const workspaceB = await mkdtemp(join(tmpdir(), 'tgbuddy-e2e-ws-b-'))
  try {
    // 默认工作区（仓库根）中先建一个会话
    await createSession(tgbuddy.page)
    await sendAndWait(tgbuddy.page, 'M2 直接回复', 'E2E 回复：M2 直接回复')

    // 添加并选中工作区 A（preload IPC + 刷新镜像）
    await addWorkspace(tgbuddy.page, workspaceA)
    await expect(tgbuddy.page.getByTestId('session-item')).toHaveCount(0)
    await createSession(tgbuddy.page)
    await sendAndWait(tgbuddy.page, 'A 工作区消息', 'E2E 回复：A 工作区消息')

    // 切到 B：A 的会话不可见
    await addWorkspace(tgbuddy.page, workspaceB)
    await expect(tgbuddy.page.getByTestId('session-item')).toHaveCount(0)

    // 切回 A：会话恢复可见
    await switchWorkspace(tgbuddy.page, (await workspaceName(tgbuddy.page, 1)) || '')
    await expect(tgbuddy.page.getByTestId('session-item')).toHaveCount(1)
    await tgbuddy.page.getByTestId('session-item').click()
    await expect(tgbuddy.page.getByText('A 工作区消息', { exact: true })).toBeVisible()
  } finally {
    await Promise.all([
      rm(workspaceA, { recursive: true, force: true }),
      rm(workspaceB, { recursive: true, force: true }),
    ])
  }
})

test('工作区目录丢失时新 run 被阻止并给出恢复动作，目录恢复后可用', async ({ tgbuddy }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tgbuddy-e2e-mount-'))
  try {
    await addWorkspace(tgbuddy.page, workspace)
    await createSession(tgbuddy.page)

    // 目录丢失：run 被阻止，错误可见（不默默回退 cwd）
    await rm(workspace, { recursive: true, force: true })
    const input = tgbuddy.page.getByPlaceholder(/给 Agent 下达任务/)
    await input.fill('M2 直接回复')
    await tgbuddy.page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(tgbuddy.page.getByText(/工作区目录不存在/).first()).toBeVisible()
    await expect(tgbuddy.page.getByRole('button', { name: '发送', exact: true })).toBeVisible()

    // 目录恢复后下一次 run 可用
    await mkdir(workspace, { recursive: true })
    await sendAndWait(tgbuddy.page, 'M2 直接回复', 'E2E 回复：M2 直接回复')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
