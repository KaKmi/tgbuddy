/**
 * A08：「让 Agent 改这份」的输入草稿注入（纯函数，便于 state test）。
 * 只把引用和意图放进输入区，用户确认发送后才启动 Run；不自动发送。
 */

const EDIT_MARKER = '请修改这个文件'

/** 在已有草稿末尾追加修改意图；已注入过则原样返回（幂等）。 */
export function injectEditIntent(draft: string, path: string): string {
  if (hasEditIntent(draft, path)) return draft
  const instruction = `${EDIT_MARKER}：${path}`
  return draft.trim() === '' ? instruction : `${draft.trim()}\n\n${instruction}`
}

export function hasEditIntent(draft: string, path: string): boolean {
  return draft.includes(`${EDIT_MARKER}：${path}`)
}

/** 切换会话时清理不属于当前会话的注入引用（RED：不残留错误引用）。 */
export function stripEditIntent(draft: string, path: string): string {
  const marker = `${EDIT_MARKER}：${path}`
  return draft
    .split('\n')
    .filter((line) => !line.trim().includes(marker))
    .join('\n')
    .trim()
}
