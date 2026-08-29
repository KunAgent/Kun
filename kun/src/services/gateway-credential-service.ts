import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { SecretEncryptor } from '../security/secret-store.js'

const GATEWAY_KEY_AAD = 'kun-local-model-gateway-key:v1'

export type GatewayCredentialStatus = {
  configured: boolean
  createdAt?: string
  rotatedAt?: string
}

type StoredGatewayCredential = {
  schemaVersion: 1
  encryptedKey: string
  createdAt: string
  rotatedAt?: string
}

/** Runtime-owned credential boundary for the public OpenAI-compatible API. */
export class GatewayCredentialService {
  readonly directory: string
  readonly path: string
  private key: string | null = null
  private metadata: Omit<GatewayCredentialStatus, 'configured'> = {}
  private operation: Promise<unknown> = Promise.resolve()

  constructor(
    dataDir: string,
    private readonly encryptor: SecretEncryptor,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {
    this.directory = join(dataDir, 'model-gateway')
    this.path = join(this.directory, 'api-key.enc.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    const stored = parseStoredCredential(raw)
    const key = this.encryptor.decrypt(stored.encryptedKey, GATEWAY_KEY_AAD)
    if (!isGatewayKey(key)) throw new Error('stored local gateway key is invalid')
    this.key = key
    this.metadata = {
      createdAt: stored.createdAt,
      ...(stored.rotatedAt ? { rotatedAt: stored.rotatedAt } : {})
    }
    await chmod(this.path, 0o600)
  }

  status(): GatewayCredentialStatus {
    return { configured: this.key !== null, ...this.metadata }
  }

  hasKey(): boolean {
    return this.key !== null
  }

  verify(candidate: string | null): boolean {
    if (!this.key || !candidate) return false
    return timingSafeEqual(digest(candidate), digest(this.key))
  }

  ensure(): Promise<{ key: string; created: boolean }> {
    return this.serialize(async () => {
      if (this.key) return { key: this.key, created: false }
      const key = generateGatewayKey()
      const createdAt = this.nowIso()
      await this.persist(key, { createdAt })
      this.key = key
      this.metadata = { createdAt }
      return { key, created: true }
    })
  }

  rotate(): Promise<{ key: string }> {
    return this.serialize(async () => {
      const key = generateGatewayKey()
      const createdAt = this.metadata.createdAt ?? this.nowIso()
      const rotatedAt = this.nowIso()
      await this.persist(key, { createdAt, rotatedAt })
      this.key = key
      this.metadata = { createdAt, rotatedAt }
      return { key }
    })
  }

  revoke(): Promise<boolean> {
    return this.serialize(async () => {
      const revoked = this.key !== null
      await rm(this.path, { force: true })
      this.key = null
      this.metadata = {}
      return revoked
    })
  }

  reveal(): string | null {
    return this.key
  }

  private async persist(
    key: string,
    metadata: { createdAt: string; rotatedAt?: string }
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const stored: StoredGatewayCredential = {
      schemaVersion: 1,
      encryptedKey: this.encryptor.encrypt(key, GATEWAY_KEY_AAD),
      ...metadata
    }
    await atomicWriteFile(this.path, `${JSON.stringify(stored, null, 2)}\n`)
    await chmod(this.path, 0o600)
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}

function generateGatewayKey(): string {
  return `kun_local_${randomBytes(32).toString('base64url')}`
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function isGatewayKey(value: string): boolean {
  return /^kun_local_[A-Za-z0-9_-]{43}$/.test(value)
}

function parseStoredCredential(raw: string): StoredGatewayCredential {
  const value = JSON.parse(raw) as Partial<StoredGatewayCredential>
  if (
    value.schemaVersion !== 1 ||
    typeof value.encryptedKey !== 'string' ||
    typeof value.createdAt !== 'string' ||
    (value.rotatedAt !== undefined && typeof value.rotatedAt !== 'string')
  ) throw new Error('stored local gateway credential is malformed')
  return value as StoredGatewayCredential
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
