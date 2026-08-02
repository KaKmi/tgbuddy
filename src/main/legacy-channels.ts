/**
 * 旧 `channels.json` 的一次性迁移读取（C02 后渠道 canonical 是 SQLite）。
 * 读取 .env 开发兜底 + channels.json；迁移完成后由调用方改名旧文件。
 */

import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Channel } from '../shared/contracts/channel.ts'
import { deepseekChannel } from '../shared/channel-presets.ts'
import { DATA_DIR, ensureDataDir } from './data-dir.ts'

const CHANNELS_FILE = join(DATA_DIR, 'channels.json')

/**
 * 开发期读取项目根目录的 `.env`。
 *
 * ⚠️ Bun 会自动加载 .env，但 Electron 不会；只在开发期用。
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
 */
export function readLegacyChannels(): Channel[] {
  ensureDataDir()
  if (existsSync(CHANNELS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(CHANNELS_FILE, 'utf-8')) as {
        channels?: Channel[]
      }
      if (Array.isArray(parsed.channels)) return parsed.channels
    } catch (e) {
      console.error('[channel] channels.json 解析失败，忽略：', e)
    }
  }
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
