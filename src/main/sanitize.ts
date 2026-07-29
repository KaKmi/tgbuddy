/**
 * 落盘前的消息瘦身。
 *
 * **不做这个，一个会话的 JSONL 几天就能涨到几百 MB。** 罪魁是两样：
 *   ① base64 图片 —— 一张截图就是几百 KB 的字符串
 *   ② 超大 tool_result —— 一次 grep 可能返回几 MB
 *
 * 超大消息落盘前必须裁剪，避免会话文件持续膨胀。
 *
 * ⚠️ 只影响**落盘**。送给模型的内容不受影响 —— pi 的上下文管理和压缩
 *    走的是内存里的 `agent.state.messages`，跟这里无关。
 */

import type { SessionMessage } from '../shared/types/message.ts'

/** 单条消息序列化后的上限 */
const MAX_MESSAGE_CHARS = 256_000
/** 单个文本块的上限 */
const MAX_TEXT_CHARS = 64_000

interface Truncated {
  _truncated: true
  _originalLength: number
}

/**
 * 超限才处理，不超限原样返回（避免无谓的深拷贝）。
 */
export function sanitizeForDisk(message: SessionMessage): SessionMessage {
  // notice 消息很小，不会超限
  if (message.kind !== 'kernel') return message

  const serialized = JSON.stringify(message)
  if (serialized.length <= MAX_MESSAGE_CHARS) return message

  console.warn(
    `[sanitize] 消息过大（${(serialized.length / 1024).toFixed(0)} KB），落盘前瘦身：${message.id}`,
  )

  const inner = message.message
  const content = inner.content

  // pi 的 UserMessage.content 允许是 string
  if (typeof content === 'string') {
    return {
      ...message,
      message: { ...inner, content: truncateText(content) } as typeof inner,
    }
  }

  const slimmed = content.map((block) => {
    // ① base64 图片：整块剥掉，只留尺寸信息
    if (block.type === 'image') {
      const original = block.data.length
      return { ...block, data: '', ...({ _truncated: true, _originalLength: original } as Truncated) }
    }
    // ② 超长文本
    if (block.type === 'text' && block.text.length > MAX_TEXT_CHARS) {
      return { ...block, text: truncateText(block.text) }
    }
    return block
  })

  return { ...message, message: { ...inner, content: slimmed } as typeof inner }
}

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text
  const head = text.slice(0, MAX_TEXT_CHARS)
  return `${head}\n\n…[已截断，原长度 ${text.length} 字符。完整内容未落盘]`
}
