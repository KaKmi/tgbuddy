import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EncryptedFileSecretStore,
  type SecretCipher,
} from '../../../src/infrastructure/secrets/index.ts'
import {
  createSecretRef,
  MemorySecretStore,
  type SecretRef,
  type SecretStore,
} from '../../../src/runtime/secrets/secret-store.ts'

/**
 * 测试专用可逆加密：只验证「明文不落盘」与「重启可读回」，
 * 不触碰真实系统钥匙串（Windows DPAPI / macOS Keychain）。
 */
class FakeCipher implements SecretCipher {
  readonly #available: boolean

  constructor(available = true) {
    this.#available = available
  }

  isEncryptionAvailable(): boolean {
    return this.#available
  }

  encryptString(plainText: string): Buffer {
    return Buffer.from(`v1:${plainText}`, 'utf8')
  }

  decryptString(encrypted: Buffer): string {
    const text = encrypted.toString('utf8')
    if (!text.startsWith('v1:')) throw new Error('密文格式不匹配')
    return text.slice(3)
  }
}

/** 只对指定前缀明文解密失败，模拟单条凭据损坏。 */
class SelectiveFakeCipher extends FakeCipher {
  override encryptString(plainText: string): Buffer {
    return Buffer.from(
      plainText.startsWith('broken') ? `v1:broken:${plainText}` : `v1:${plainText}`,
      'utf8',
    )
  }

  override decryptString(encrypted: Buffer): string {
    const text = encrypted.toString('utf8')
    if (text.startsWith('v1:broken:')) throw new Error('模拟解密失败')
    return super.decryptString(encrypted)
  }
}

function tempSecretFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tgbuddy-secret-test-'))
  return join(dir, 'secrets.json')
}

function withTempFile(run: (filePath: string) => void): void {
  const filePath = tempSecretFile()
  try {
    run(filePath)
  } finally {
    rmSync(filePath, { force: true })
    rmSync(`${filePath}.tmp`, { force: true })
  }
}

describe('MemorySecretStore（fake adapter）', () => {
  test('set/get/delete 与缺失 ref 语义', () => {
    const store: SecretStore = new MemorySecretStore()
    const ref: SecretRef = createSecretRef(() => 'abc')
    expect(ref).toBe('secret_abc')
    expect(store.get(ref)).toBeUndefined()
    store.set(ref, 'sk-test-123')
    expect(store.get(ref)).toBe('sk-test-123')
    store.delete(ref)
    expect(store.get(ref)).toBeUndefined()
  })
})

describe('EncryptedFileSecretStore（OS adapter）', () => {
  test('set 后可读回，缺失 ref 返回 undefined', () => {
    withTempFile((filePath) => {
      const store = new EncryptedFileSecretStore({
        cipher: new FakeCipher(),
        filePath,
      })
      const ref = createSecretRef(() => 'r1')
      store.set(ref, 'sk-live-key')
      expect(store.get(ref)).toBe('sk-live-key')
      expect(store.get(createSecretRef(() => 'missing'))).toBeUndefined()
    })
  })

  test('delete 后 ref 不再可读', () => {
    withTempFile((filePath) => {
      const store = new EncryptedFileSecretStore({
        cipher: new FakeCipher(),
        filePath,
      })
      const ref = createSecretRef(() => 'r2')
      store.set(ref, 'sk-delete-me')
      store.delete(ref)
      expect(store.get(ref)).toBeUndefined()
    })
  })

  test('重启（重新打开同一文件）后密钥仍可读回', () => {
    withTempFile((filePath) => {
      const first = new EncryptedFileSecretStore({
        cipher: new FakeCipher(),
        filePath,
      })
      const ref = createSecretRef(() => 'persist')
      first.set(ref, 'sk-after-restart')

      const reopened = new EncryptedFileSecretStore({
        cipher: new FakeCipher(),
        filePath,
      })
      expect(reopened.get(ref)).toBe('sk-after-restart')
    })
  })

  test('落盘序列化结果不含明文密钥', () => {
    withTempFile((filePath) => {
      const store = new EncryptedFileSecretStore({
        cipher: new FakeCipher(),
        filePath,
      })
      store.set(createSecretRef(() => 'r3'), 'sk-top-secret')
      expect(existsSync(filePath)).toBe(true)
      const raw = readFileSync(filePath, 'utf8')
      expect(raw).not.toContain('sk-top-secret')
      expect(raw).toContain('secret_r3')
    })
  })

  test('系统加密不可用时 set 拒绝保存，get 返回 undefined', () => {
    withTempFile((filePath) => {
      const store = new EncryptedFileSecretStore({
        cipher: new FakeCipher(false),
        filePath,
      })
      const ref = createSecretRef(() => 'r4')
      expect(() => store.set(ref, 'sk-unavailable')).toThrow(/加密不可用/)
      expect(store.get(ref)).toBeUndefined()
    })
  })

  test('密钥文件损坏时读取抛出可诊断错误，不静默丢密钥', () => {
    withTempFile((filePath) => {
      // 先写坏文件，模拟重启时磁盘上已是损坏状态
      writeFileSync(filePath, '{ 坏 json', 'utf8')
      const store = new EncryptedFileSecretStore({
        cipher: new FakeCipher(),
        filePath,
      })
      const ref = createSecretRef(() => 'r5')
      expect(() => store.get(ref)).toThrow(/密钥文件/)
    })
  })

  test('secrets 为 null/数组时视为格式不合法并抛可诊断错误', () => {
    for (const bad of ['{"version":1,"secrets":null}', '{"version":1,"secrets":[]}']) {
      withTempFile((filePath) => {
        writeFileSync(filePath, bad, 'utf8')
        const store = new EncryptedFileSecretStore({
          cipher: new FakeCipher(),
          filePath,
        })
        expect(() => store.get(createSecretRef(() => 'r'))).toThrow(/格式不合法/)
      })
    }
  })

  test('单条密钥解密失败不拖垮其它密钥，且可重新保存恢复', () => {
    withTempFile((filePath) => {
      const broken = createSecretRef(() => 'broken')
      const healthy = createSecretRef(() => 'healthy')
      const writer = new EncryptedFileSecretStore({
        cipher: new SelectiveFakeCipher(),
        filePath,
      })
      writer.set(broken, 'broken-secret')
      writer.set(healthy, 'sk-healthy')

      // 新实例（重启）读取：坏密钥只影响自身
      const reader = new EncryptedFileSecretStore({
        cipher: new SelectiveFakeCipher(),
        filePath,
      })
      expect(() => reader.get(broken)).toThrow(/解密失败/)
      expect(reader.get(healthy)).toBe('sk-healthy')

      // 重新保存坏密钥后恢复
      reader.set(broken, 'sk-replaced')
      expect(reader.get(broken)).toBe('sk-replaced')
    })
  })
})
