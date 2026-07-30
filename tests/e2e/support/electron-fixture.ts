import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import {
  mkdir,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startFakeOpenAiServer,
  type FakeOpenAiServer,
} from './fake-openai-server'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export interface TgBuddyElectron {
  readonly page: Page
  restart(options?: { hard?: boolean }): Promise<void>
}

interface E2EFixtures {
  tgbuddy: TgBuddyElectron
}

class ElectronHarness implements TgBuddyElectron {
  readonly #dataDir: string
  readonly #userDataDir: string
  readonly #modelServer: FakeOpenAiServer
  #application: ElectronApplication | undefined
  #page: Page | undefined

  constructor(
    rootDir: string,
    modelServer: FakeOpenAiServer,
  ) {
    this.#dataDir = join(rootDir, 'data')
    this.#userDataDir = join(rootDir, 'user-data')
    this.#modelServer = modelServer
  }

  get page(): Page {
    if (!this.#page) throw new Error('Electron E2E 窗口尚未启动')
    return this.#page
  }

  async initialize(): Promise<void> {
    const workspace = join(this.#dataDir, 'workspaces', 'default')
    await mkdir(workspace, { recursive: true })
    await mkdir(this.#userDataDir, { recursive: true })
    await writeFile(
      join(workspace, 'README.md'),
      '# E2E Workspace\n\nE2E_WORKSPACE_CONTENT\n',
      'utf8',
    )
    await writeFile(
      join(workspace, 'LARGE.txt'),
      Array.from(
        { length: 2_400 },
        (_, index) => `${String(index).padStart(4, '0')} ${'x'.repeat(88)}`,
      ).join('\n'),
      'utf8',
    )
    await writeFile(
      join(this.#dataDir, 'channels.json'),
      JSON.stringify({
        channels: [{
          id: 'e2e',
          name: 'E2E 本地模型',
          protocol: 'openai',
          baseUrl: this.#modelServer.baseUrl,
          apiKey: 'e2e-key',
          models: [{
            id: 'e2e-model',
            name: 'E2E Model',
            contextWindow: 1_000_000,
            maxTokens: 4_096,
            compat: {
              supportsDeveloperRole: false,
              supportsStore: false,
              maxTokensField: 'max_tokens',
            },
          }],
        }],
      }, null, 2),
      'utf8',
    )
    await this.#launch()
  }

  async restart(options: { hard?: boolean } = {}): Promise<void> {
    await this.#stop(Boolean(options.hard))
    await this.#launch()
  }

  async dispose(): Promise<void> {
    await this.#stop(false)
    await this.#modelServer.close()
    // Windows 会在 Electron 退出后继续短暂持有 Chromium DIPS 句柄。
    // 临时目录由 E2E 阶段在 runner 完全退出后统一清理，避免 teardown 被系统锁误报。
  }

  async #launch(): Promise<void> {
    this.#application = await electron.launch({
      args: [
        '.',
        `--user-data-dir=${this.#userDataDir}`,
        '--disable-gpu',
      ],
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        TGBUDDY_DATA_DIR: this.#dataDir,
        TGBUDDY_E2E: '1',
      },
    })
    this.#page = await this.#application.firstWindow()
    await this.#page.getByRole('button', { name: '+ 新会话' }).waitFor()
  }

  async #stop(hard: boolean): Promise<void> {
    const application = this.#application
    this.#application = undefined
    this.#page = undefined
    if (!application) return

    if (!hard) {
      const child = application.process()
      const closed = application.close().then(
        () => true,
        () => true,
      )
      const graceful = await Promise.race([
        closed,
        new Promise<false>((resolveTimeout) => {
          setTimeout(() => resolveTimeout(false), 5_000)
        }),
      ])
      if (!graceful && child.exitCode === null) {
        const exited = new Promise<void>((resolveExit) => {
          child.once('exit', () => resolveExit())
        })
        child.kill()
        await exited
      }
      return
    }

    const child = application.process()
    if (child.exitCode !== null) return
    const exited = new Promise<void>((resolveExit) => {
      child.once('exit', () => resolveExit())
    })
    child.kill()
    await exited
  }
}

export const test = base.extend<E2EFixtures>({
  tgbuddy: async ({}, use, testInfo) => {
    const rootDir = testInfo.outputPath('runtime')
    await mkdir(rootDir, { recursive: true })
    const server = await startFakeOpenAiServer()
    const harness = new ElectronHarness(rootDir, server)
    try {
      await harness.initialize()
      await use(harness)
    } finally {
      await harness.dispose()
    }
  },
})

export { expect } from '@playwright/test'
