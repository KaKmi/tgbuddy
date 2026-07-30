/**
 * 渠道存储。
 *
 * 阶段 2 先做最小可用：从 `~/.tgbuddy/channels.json` 读，
 * 文件不存在时用环境变量 `DEEPSEEK_API_KEY` 兜底建一个默认渠道，
 * 这样 probe 能跑通的配置，界面上也能直接跑。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Channel } from '../shared/types/channel.ts'
import { deepseekChannel } from '../shared/channel-presets.ts'

/**
 * E2E 与便携运行可以显式隔离应用数据；默认位置仍保持向后兼容。
 *
 * 这个入口必须在模块加载时确定，因为权限、渠道和 Workspace 共享同一数据根。
 */
export const DATA_DIR =
  process.env.TGBUDDY_DATA_DIR ?? join(homedir(), '.tgbuddy')
const CHANNELS_FILE = join(DATA_DIR, 'channels.json')

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * 开发期读取项目根目录的 `.env`。
 *
 * ⚠️ 这不是多余的：**Bun 会自动加载 .env，但 Electron 不会**。
 *    `bun run probe` 能跑通的配置，`electron .` 里 `process.env` 是空的 ——
 *    这正是 docs/01 里那条「GUI 启动的 Electron 读不到 shell 环境变量」的现实版。
 *
 * 只在开发期用。正式配置走 `~/.tgbuddy/channels.json`（阶段 4 会有设置界面）。
 * 已存在的环境变量不覆盖。
 */
function loadDotEnv(): void {
  const envFile = join(process.cwd(), '.env')
  if (!existsSync(envFile)) return

  try {
    for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      // 去掉可能的引号
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !process.env[key]) process.env[key] = value
    }
  } catch (e) {
    console.error('[channel] .env 读取失败，忽略：', e)
  }
}

export function listChannels(): Channel[] {
  ensureDataDir()

  if (existsSync(CHANNELS_FILE)) {
    try {
      // TODO(阶段 3): 换成 safe-file.ts 的 readJsonFileSafe（.tmp / .bak 三级回退）
      const parsed = JSON.parse(readFileSync(CHANNELS_FILE, 'utf-8')) as { channels?: Channel[] }
      if (Array.isArray(parsed.channels)) return parsed.channels
    } catch (e) {
      console.error('[channel] channels.json 解析失败，忽略：', e)
    }
  }

  // 兜底：环境变量里有 key 就建一个 DeepSeek 渠道
  loadDotEnv()
  const key = process.env.DEEPSEEK_API_KEY
  return key ? [deepseekChannel(key)] : []
}

export function saveChannels(channels: Channel[]): void {
  ensureDataDir()
  // TODO(阶段 4): apiKey 必须经 Electron safeStorage 加密后再落盘。
  //   现在是明文，只在本地开发期可接受；正式版本要用 Electron safeStorage 加密。
  writeFileSync(CHANNELS_FILE, JSON.stringify({ channels }, null, 2), 'utf-8')
}
