/**
 * 密钥引用 —— 结构化存储（SQLite / IPC）只允许保存引用，
 * 明文只能经 SecretStore 读写。
 */
export type SecretRef = string
