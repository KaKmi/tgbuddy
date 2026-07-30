import { randomUUID } from 'node:crypto'

/**
 * 跨 Session、Run 与消息共用 128-bit ID，避免旧 8 位随机值在长期数据中碰撞。
 */
export function createId(): string {
  return randomUUID()
}
