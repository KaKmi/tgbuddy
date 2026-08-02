import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { SecretRef } from '../../shared/contracts/secret.ts'
import type { SecretStore } from '../../runtime/secrets/secret-store.ts'

/**
 * 加密原语端口。Electron `safeStorage` 的结构化形状正好满足它，
 * 测试注入可控 fake，避免触碰真实系统凭据。
 */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface SecretPayload {
  /** 加密算法版本，未来换算法时按版本迁移 */
  v: 1
  /** 加密后字节的 base64 表示 */
  payload: string
}

interface SecretFileShape {
  version: 1
  secrets: Record<SecretRef, SecretPayload>
}

const FILE_VERSION = 1 as const

/**
 * 基于 OS 加密原语（Windows DPAPI / macOS Keychain）的密钥存储：
 * 明文只存在于内存，磁盘上只有加密后的 blob，SQLite 只存 ref。
 * 写入走临时文件 + rename，避免崩溃留下半个 JSON。
 */
export class EncryptedFileSecretStore implements SecretStore {
  readonly #cipher: SecretCipher
  readonly #filePath: string
  #cache: Map<SecretRef, string> | undefined
  #failed = new Set<SecretRef>()

  constructor(options: { cipher: SecretCipher; filePath: string }) {
    this.#cipher = options.cipher
    this.#filePath = options.filePath
  }

  set(ref: SecretRef, value: string): void {
    if (!this.#cipher.isEncryptionAvailable()) {
      throw new Error('系统加密不可用，拒绝保存密钥明文')
    }
    const cache = this.#load()
    cache.set(ref, value)
    this.#failed.delete(ref)
    try {
      this.#persist(cache)
    } catch (error) {
      // 写盘失败时回滚内存缓存，避免重启后读到与磁盘不一致的旧值。
      this.#cache = undefined
      throw error
    }
  }

  get(ref: SecretRef): string | undefined {
    if (!this.#cipher.isEncryptionAvailable()) {
      console.error('[secret-store] 系统加密不可用，无法读取密钥')
      return undefined
    }
    const cache = this.#load()
    if (this.#failed.has(ref)) {
      throw new Error(`密钥 ${ref} 解密失败（系统凭据可能已变更），请重新保存该密钥`)
    }
    return cache.get(ref)
  }

  delete(ref: SecretRef): void {
    if (!this.#cipher.isEncryptionAvailable()) return
    const cache = this.#load()
    cache.delete(ref)
    this.#failed.delete(ref)
    try {
      this.#persist(cache)
    } catch (error) {
      this.#cache = undefined
      throw error
    }
  }

  /**
   * 延迟加载并解密整个文件。密钥数量很少（渠道/凭据级别），
   * 一次解密换 get 的同步简单性，不需要逐条懒加载。
   */
  #load(): Map<SecretRef, string> {
    if (this.#cache) return this.#cache
    const cache = new Map<SecretRef, string>()
    const failed = new Set<SecretRef>()
    if (existsSync(this.#filePath)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(this.#filePath, 'utf8')) as unknown
      } catch (error) {
        throw new Error(`密钥文件损坏，无法解析：${this.#filePath}`, {
          cause: error,
        })
      }
      if (!isSecretFileShape(parsed)) {
        throw new Error(`密钥文件格式不合法：${this.#filePath}`)
      }
      for (const [ref, entry] of Object.entries(parsed.secrets)) {
        try {
          cache.set(
            ref,
            this.#cipher.decryptString(Buffer.from(entry.payload, 'base64')),
          )
        } catch (error) {
          // 单条密钥解密失败只标记该 ref，不拖垮其它密钥与应用启动；
          // 访问该 ref 时给出可操作错误，配置仍可重新保存。
          console.error(`[secret-store] 密钥 ${ref} 解密失败（跳过，等待重新保存）`, error)
          failed.add(ref)
        }
      }
    }
    this.#cache = cache
    this.#failed = failed
    return cache
  }

  #persist(cache: Map<SecretRef, string>): void {
    const shape: SecretFileShape = {
      version: FILE_VERSION,
      secrets: {},
    }
    for (const [ref, value] of cache) {
      shape.secrets[ref] = {
        v: FILE_VERSION,
        payload: this.#cipher.encryptString(value).toString('base64'),
      }
    }
    const tmp = `${this.#filePath}.tmp`
    mkdirSync(dirname(this.#filePath), { recursive: true })
    // rename 在同一分区上是原子的：要么旧文件，要么新文件，不存在中间态。
    writeFileSync(tmp, JSON.stringify(shape, null, 2), 'utf8')
    renameSync(tmp, this.#filePath)
  }
}

function isSecretFileShape(value: unknown): value is SecretFileShape {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { version?: unknown; secrets?: unknown }
  return (
    candidate.version === FILE_VERSION
    && typeof candidate.secrets === 'object'
    && candidate.secrets !== null
    && !Array.isArray(candidate.secrets)
  )
}
