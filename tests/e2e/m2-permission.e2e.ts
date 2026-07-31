import type { Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './support/electron-fixture'

async function createSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ 新会话' }).click()
  await expect(page.getByPlaceholder(/说点什么/)).toBeEnabled()
}

async function switchToWorkspace(page: Page, path: string): Promise<void> {
  await page.evaluate(async (workspacePath) => {
    const workspaces = await window.tgbuddy.workspace.list()
    let match = workspaces.find((workspace) => workspace.mount?.path === workspacePath)
    // 测试路径可能是全新目录：走与 UI「选择其他文件夹」相同的 create（已有路径会去重）
    match ??= await window.tgbuddy.workspace.create({ path: workspacePath })
    await window.tgbuddy.workspace.select(match.id)
  }, path)
  await page.reload()
  await expect(page.getByTestId('workspace-picker')).toBeVisible()
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder(/说点什么/)
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('写工具默认询问：允许后执行成功，拒绝后工具落为已拒绝', async ({ tgbuddy }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tgbuddy-e2e-perm-'))
  try {
    await switchToWorkspace(tgbuddy.page, workspace)
    await createSession(tgbuddy.page)

    // 允许：inline 授权卡 → 工具执行 → 模型收到结果后回复
    await send(tgbuddy.page, 'M2 写入')
    await expect(tgbuddy.page.getByText('请求执行 write')).toBeVisible()
    await tgbuddy.page.getByRole('button', { name: '允许', exact: true }).click()
    await expect(tgbuddy.page.getByText('M2 写入完成', { exact: true })).toBeVisible()
    expect(existsSync(join(workspace, 'm2-write.txt'))).toBe(true)

    // 拒绝：工具不执行，卡片落为已拒绝，发送恢复可用
    await send(tgbuddy.page, 'M2 写入')
    await expect(tgbuddy.page.getByText('请求执行 write')).toBeVisible()
    await tgbuddy.page.getByRole('button', { name: '拒绝', exact: true }).click()
    // 拒绝的耐用证据：策略把拦截原因回给模型，模型不再拿到结果
    await expect(tgbuddy.page.getByText(/用户拒绝了授权/)).toBeVisible()
    await expect(tgbuddy.page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('高危不可逆操作升级为模态确认，且不提供「总是允许」', async ({ tgbuddy }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tgbuddy-e2e-modal-'))
  try {
    await switchToWorkspace(tgbuddy.page, workspace)
    await createSession(tgbuddy.page)
    await writeFile(join(workspace, 'm2-delete.txt'), '要删除的内容', 'utf8')

    await send(tgbuddy.page, 'M2 删除')
    await expect(tgbuddy.page.getByText('确认删除文件？')).toBeVisible()
    await expect(tgbuddy.page.getByText('高危 · 不可逆', { exact: true })).toBeVisible()
    // neverPersist：模态里不允许保存规则
    await expect(tgbuddy.page.getByText('总是允许（可选）')).toHaveCount(0)

    await tgbuddy.page.getByRole('button', { name: '允许执行', exact: true }).click()
    await expect(tgbuddy.page.getByText('M2 删除完成', { exact: true })).toBeVisible()
    expect(existsSync(join(workspace, 'm2-delete.txt'))).toBe(false)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('「总是允许」规则跨重启生效：授权一次后不再询问', async ({ tgbuddy }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tgbuddy-e2e-grant-'))
  try {
    await switchToWorkspace(tgbuddy.page, workspace)
    await createSession(tgbuddy.page)

    // 授权时勾选候选粒度（默认本项目 scope）
    await send(tgbuddy.page, 'M2 写入')
    await expect(tgbuddy.page.getByText('请求执行 write')).toBeVisible()
    await tgbuddy.page.locator('input[name^="grant-"]').first().check()
    await tgbuddy.page.getByRole('button', { name: '允许', exact: true }).click()
    await expect(tgbuddy.page.getByText('M2 写入完成', { exact: true })).toBeVisible()

    // 硬重启：规则从 SQLite 恢复，同路径写不再询问
    await tgbuddy.restart({ hard: true })
    await switchToWorkspace(tgbuddy.page, workspace)
    await tgbuddy.page.getByTestId('session-item').click()
    await send(tgbuddy.page, 'M2 写入')
    await expect(tgbuddy.page.getByText('请求执行 write')).toHaveCount(0)
    await expect(tgbuddy.page.getByText('M2 写入完成', { exact: true })).toBeVisible()
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
