/**
 * 应用数据根目录（由 channel-store 拆出，C12 删除旧 owner）。
 * E2E 与便携运行可以显式隔离应用数据；默认位置保持向后兼容。
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR =
  process.env.TGBUDDY_DATA_DIR ?? join(homedir(), '.tgbuddy')

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}
