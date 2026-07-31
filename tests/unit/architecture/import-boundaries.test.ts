import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checkArchitecture,
  formatArchitectureViolation,
  LEGACY_COMPATIBILITY,
} from '../../../scripts/check-architecture.ts'

const temporaryProjects: string[] = []

function createProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tgbuddy-architecture-'))
  temporaryProjects.push(root)

  const defaults: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
          '@runtime/*': ['src/runtime/*'],
        },
      },
    }),
    'vite.config.ts': `
      import { resolve } from 'node:path'
      export default {
        resolve: {
          alias: {
            '@': resolve(import.meta.dirname, 'src'),
            '@runtime': resolve(import.meta.dirname, 'src/runtime'),
          },
        },
      }
    `,
  }

  for (const [relativePath, content] of Object.entries({ ...defaults, ...files })) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content)
  }

  return root
}

afterEach(() => {
  for (const root of temporaryProjects.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('仓库 import 边界', () => {
  test('逐层接受合法依赖并解析 alias、扩展名与目录 index', () => {
    const root = createProject({
      'src/shared/contracts/ids.ts': 'export type SessionId = string',
      'src/shared/contracts/message.ts': `
        import type { Message } from '@earendil-works/pi-ai'
        export interface Envelope { message: Message }
      `,
      'src/shared/contracts/events.ts': `
        import type { StopReason, Usage } from '@earendil-works/pi-ai'
        export interface EndEvent { reason: StopReason; usage: Usage }
      `,
      'src/runtime/ports/index.ts': 'export interface AgentEngine {}',
      'src/runtime/index.ts': `
        export type { AgentEngine } from './ports/index.ts'
        export interface AgentRuntime {}
      `,
      'src/kernel/pi/pi-agent-engine.ts':
        "import type { AgentEngine } from '@runtime/ports'\nimport './pi-message-adapter.ts'\nimport type { Agent } from '@earendil-works/pi-agent-core'",
      'src/kernel/pi/pi-message-adapter.ts': 'export const adapter = true',
      'src/infrastructure/sqlite/repository.ts':
        "import type { AgentEngine } from '../../runtime/ports/index.ts'\nimport migration from './migrations/001.sql'\nimport { readFileSync } from 'node:fs'\nexport { migration }",
      'src/infrastructure/sqlite/migrations/001.sql': 'SELECT 1;',
      'src/main/bootstrap/create-application.ts':
        "import type { AgentRuntime } from '../../runtime/index.ts'\nimport { app } from 'electron'",
      'src/main/ipc/register-ipc.ts':
        "import type { AgentRuntime } from '../../runtime/index.ts'\nimport { ipcMain } from 'electron'",
      'src/main/window.ts':
        "import type { AgentRuntime } from '../runtime/index.ts'\nimport { BrowserWindow } from 'electron'",
      'src/preload/index.ts':
        "import type { SessionId } from '../shared/contracts/ids.ts'\nimport { contextBridge } from 'electron'",
      'src/renderer/app/App.tsx':
        "import type { SessionId } from '@/shared/contracts/ids.ts'\nimport React from 'react'",
    })

    expect(checkArchitecture({ projectRoot: root })).toEqual([])
  })

  test('逐层拒绝反向依赖并聚合 source、target、rule', () => {
    const root = createProject({
      'src/shared/contracts/bad.ts': "import '../../runtime/index.ts'",
      'src/runtime/index.ts': "import '../main/window.ts'",
      'src/runtime/bad-node.ts': "import { readFileSync } from 'node:fs'",
      'src/kernel/pi/bad.ts': "import '../../infrastructure/sqlite/repository.ts'",
      'src/infrastructure/sqlite/bad.ts': "import '../../kernel/pi/pi-agent-engine.ts'",
      'src/main/bootstrap/bad.ts': "import '../../renderer/app/App.tsx'",
      'src/main/ipc/bad.ts': "import '../../runtime/sessions/session-service.ts'",
      'src/main/ipc.ts': "import './session-store.ts'",
      'src/main/session-store.ts': 'export const store = true',
      'src/main/window.ts': "import '../infrastructure/sqlite/repository.ts'",
      'src/preload/bad.ts': "import '../runtime/index.ts'",
      'src/renderer/app/App.tsx': "import '../../main/window.ts'\nimport { readFileSync } from 'node:fs'",
      'src/runtime/sessions/session-service.ts': 'export const sessionService = true',
      'src/infrastructure/sqlite/repository.ts': 'export const repository = true',
      'src/kernel/pi/pi-agent-engine.ts': 'export const engine = true',
    })

    const violations = checkArchitecture({ projectRoot: root })
    const output = violations.map(formatArchitectureViolation).join('\n')

    expect(violations.length).toBe(12)
    expect(output).toContain('src/shared/contracts/bad.ts -> src/runtime/index.ts ->')
    expect(output).toContain('src/runtime/bad-node.ts -> node:fs ->')
    expect(output).toContain('src/renderer/app/App.tsx -> src/main/window.ts ->')
    expect(output).toContain('src/renderer/app/App.tsx -> node:fs ->')
    expect(output).toContain(
      'src/main/ipc.ts -> src/main/session-store.ts -> main/ipc 只能依赖',
    )
  })

  test('动态 import 与静态 import 使用同一边界规则', () => {
    const root = createProject({
      'src/runtime/dynamic.ts': "export async function load() { return import('../main/window.ts') }",
      'src/main/window.ts': 'export const window = true',
      'src/renderer/dynamic.ts': "export async function load() { return import('node:fs') }",
    })

    const output = checkArchitecture({ projectRoot: root })
      .map(formatArchitectureViolation)
      .join('\n')

    expect(output).toContain('src/runtime/dynamic.ts -> src/main/window.ts ->')
    expect(output).toContain('src/renderer/dynamic.ts -> node:fs ->')
  })

  test('pi type-only 例外只允许指定 contract，value import 仍然失败', () => {
    const root = createProject({
      'src/shared/contracts/message.ts':
        "import { getModel } from '@earendil-works/pi-ai'\nexport { getModel }",
      'src/shared/contracts/events.ts':
        "import type { StopReason, Usage } from '@earendil-works/pi-ai'\nexport interface E { reason: StopReason; usage: Usage }",
      'src/shared/contracts/other.ts':
        "import type { Message } from '@earendil-works/pi-ai'\nexport interface X { message: Message }",
    })

    const violations = checkArchitecture({ projectRoot: root })

    expect(violations).toHaveLength(2)
    expect(violations.map((item) => item.source)).toEqual([
      'src/shared/contracts/message.ts',
      'src/shared/contracts/other.ts',
    ])
  })

  test('TypeScript 与 Vite 的同名 alias 指向不同目录时失败', () => {
    const root = createProject({
      'vite.config.ts': `
        import { resolve } from 'node:path'
        export default { resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer') } } }
      `,
      'src/renderer/main.tsx': 'export const main = true',
    })

    const violations = checkArchitecture({ projectRoot: root })

    expect(violations).toHaveLength(1)
    expect(formatArchitectureViolation(violations[0]!)).toContain(
      'tsconfig.json#@ -> vite.config.ts#@ -> alias 指向不一致',
    )
  })

  test('CLI 无违规退出 0，有违规退出 1', () => {
    const validRoot = createProject({
      'src/shared/contracts/ids.ts': 'export type SessionId = string',
    })
    const invalidRoot = createProject({
      'src/renderer/bad.ts': "import { readFileSync } from 'node:fs'",
    })
    const checker = join(import.meta.dir, '../../../scripts/check-architecture.ts')

    const valid = Bun.spawnSync([process.execPath, checker, validRoot])
    const invalid = Bun.spawnSync([process.execPath, checker, invalidRoot])

    expect(valid.exitCode).toBe(0)
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stderr.toString()).toContain(
      'src/renderer/bad.ts -> node:fs -> renderer 不得依赖 Node、pi 或 Electron',
    )
  })

  test('每个 legacy 豁免都绑定实际删除 Story', () => {
    expect(LEGACY_COMPATIBILITY).toEqual([
      { prefix: 'src/main/tools/sandbox.ts', deleteIn: 'Story 2' },
      { prefix: 'src/main/tools/sandboxed-env.ts', deleteIn: 'Story 2' },
      { prefix: 'src/main/tools/index.ts', deleteIn: 'Story 4' },
      { prefix: 'src/main/tools/plan-mode.ts', deleteIn: 'Story 4' },
      { prefix: 'src/main/tools/ask-user.ts', deleteIn: 'Story 4' },
    ])
  })

  test('M1 结束后 Session 和 Run 的 legacy owner 已物理删除', () => {
    const projectRoot = join(import.meta.dir, '../../..')
    const removedOwners = [
      'src/main/session-store.ts',
      'src/main/orchestrator.ts',
      'src/main/compaction-service.ts',
      'src/kernel/normalize.ts',
    ]

    for (const owner of removedOwners) {
      expect(existsSync(join(projectRoot, owner))).toBe(false)
    }
  })
})
