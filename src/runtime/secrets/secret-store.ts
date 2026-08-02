import type { SecretRef } from '../../shared/contracts/secret.ts'

/**
 * 密钥存储端口。Runtime 只依赖该端口，不知道 Electron safeStorage
 * 或具体加密实现；SQLite 等结构化存储永远只存 `SecretRef`。
 */
export interface SecretStore {
  set(ref: SecretRef, value: string): void
  get(ref: SecretRef): string | undefined
  delete(ref: SecretRef): void
}

/** 生成带 `secret_` 前缀的引用，避免与普通 ID 混用。 */
export function createSecretRef(createId: () => string): SecretRef {
  return `secret_${createId()}`
}

/** 测试与无 OS 钥匙串场景使用的内存实现。 */
export class MemorySecretStore implements SecretStore {
  readonly #values = new Map<SecretRef, string>()

  set(ref: SecretRef, value: string): void {
    this.#values.set(ref, value)
  }

  get(ref: SecretRef): string | undefined {
    return this.#values.get(ref)
  }

  delete(ref: SecretRef): void {
    this.#values.delete(ref)
  }
}
