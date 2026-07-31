/**
 * 渠道 legacy 读取（一次性迁移入口）。
 *
 * C02 起渠道 canonical 存储改为 SQLite `app_channels`，密钥只存
 * SecretStore 的 ref。本文件只负责把旧 `channels.json`（或环境变量
 * 兜底渠道）迁移到 SQLite，之后不再写入任何渠道数据。
 */

import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
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

/**
 * 读取 legacy 渠道：优先 channels.json；不存在时用
 * `DEEPSEEK_API_KEY` 环境变量兜底建一个默认渠道（开发兼容）。
 * 迁移完成后调用方应改读 SQLite，不再依赖本函数。
 */
export function readLegacyChannels(): Channel[] {
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

/**
 * 标记 legacy 文件已迁移：改名后下次启动不会重复导入。
 * 改名失败只记日志，不阻塞启动（SQLite 导入本身幂等）。
 */
export function markLegacyChannelsMigrated(): void {
  if (!existsSync(CHANNELS_FILE)) return
  try {
    renameSync(CHANNELS_FILE, `${CHANNELS_FILE}.migrated`)
  } catch (error) {
    console.error('[channel] channels.json 迁移标记失败（可重试）：', error)
  }
}
