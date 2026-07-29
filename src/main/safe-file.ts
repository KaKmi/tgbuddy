/**
 * 原子文件读写。
 *
 * 通过临时文件、原子替换和备份回退提升本地配置的可靠性。
 *
 * ## 为什么不能直接 writeFileSync
 *
 * `writeFileSync` 不是原子的。写到一半断电/崩溃/被杀进程，留下的是半个 JSON——
 * 下次启动解析失败，用户的会话索引就没了。
 *
 * ## 三段式
 *
 * 写：`copy → .bak` ／ `write → .tmp` ／ `rename .tmp → 主文件`
 *   `rename` 在同一分区上是原子的：要么旧文件，要么新文件，不存在中间态。
 *
 * 读：主文件 → 残留的 `.tmp` → `.bak`，三级回退。
 *   残留 `.tmp` 说明上次在 rename 之前崩了，它的内容其实是完整的新数据，
 *   所以值得一试；`.bak` 是最后的救命稻草。
 */

import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

export function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`
  const bak = `${filePath}.bak`

  // 先备份现有文件。失败不阻断——首次写入时本来就没有主文件
  if (existsSync(filePath)) {
    try {
      copyFileSync(filePath, bak)
    } catch (e) {
      console.error(`[safe-file] 备份失败（继续写入）：${bak}`, e)
    }
  }

  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, filePath) // ← 原子替换
}

/**
 * 三级回退读取。全部失败返回 null（而不是抛），让调用方决定用什么默认值。
 */
export function readJsonFileSafe<T>(filePath: string): T | null {
  const candidates = [filePath, `${filePath}.tmp`, `${filePath}.bak`]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as T

      // 从 .tmp 读成功 = 上次崩在 rename 之前，把它提升为主文件
      if (path.endsWith('.tmp')) {
        console.warn(`[safe-file] 从残留的 .tmp 恢复：${filePath}`)
        try {
          renameSync(path, filePath)
        } catch {
          /* 提升失败不影响本次读取 */
        }
      } else if (path.endsWith('.bak')) {
        console.warn(`[safe-file] 主文件损坏，已从 .bak 恢复：${filePath}`)
        // ★ 必须立刻治好主文件，否则下一次 writeJsonFileAtomic 会执行
        //    copy(损坏的主文件 → .bak)，把唯一的好备份也污染掉。
        //    那之后再写坏一次主文件，两份就都没了。
        try {
          copyFileSync(path, filePath)
        } catch (e) {
          console.error(`[safe-file] 主文件修复失败，备份有被覆盖的风险：${filePath}`, e)
        }
      }

      return parsed
    } catch (e) {
      console.error(`[safe-file] 解析失败，尝试下一级：${path}`, e)
    }
  }

  return null
}

/** 删除主文件及其 .tmp / .bak，避免残留把已删的数据"复活" */
export function removeJsonFile(filePath: string): void {
  for (const path of [filePath, `${filePath}.tmp`, `${filePath}.bak`]) {
    if (!existsSync(path)) continue
    try {
      unlinkSync(path)
    } catch (e) {
      console.error(`[safe-file] 删除失败：${path}`, e)
    }
  }
}
