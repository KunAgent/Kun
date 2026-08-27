import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExtensionCredentialProtection } from '../contracts/extension-providers.js'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import type { KeyProviderResult } from '../security/secret-store.js'

export type ExtensionCredentialPayload = {
  apiKey?: string
  accessToken?: string
  refreshToken?: string
  clientSecret?: string
  tokenType?: string
  expiresAt?: string
  scope?: string
}

export interface PrimaryCredentialBackend {
  readonly id: string
  isAvailable(): Promise<boolean>
  set(reference: string, value: string): Promise<void>
  get(reference: string): Promise<string | null>
  delete(reference: string): Promise<void>
}

type EncryptedCredential = {
  algorithm: 'aes-256-gcm'
  nonce: string
  ciphertext: string
  tag: string
  updatedAt: string
}

type EncryptedCredentialDocument = {
  schemaVersion: 1
  profileId: string
  credentials: Record<string, EncryptedCredential>
}

export type ExtensionCredentialStoreOptions = {
  dataDir: string
  profileId: string
  primary?: PrimaryCredentialBackend
  /**
   * Kun's platform key provider. When its key is held by Keychain/DPAPI this
   * is reported as primary protection; its authenticated 0600-key-file mode
   * is the explicit degraded fallback.
   */
  keyProvider?: KeyProviderResult
  nowIso?: () => string
}

/**
 * Secret store with an injectable OS-backed primary and an authenticated,
 * profile-bound AES-GCM fallback. Ordinary settings only receive opaque refs.
 */
export class ExtensionCredentialStore {
  private readonly nowIso: () => string
  private readonly keyPath: string
  private readonly encryptedPath: string
  private readonly encryptedFile: AtomicJsonFile<EncryptedCredentialDocument>
  private initialized?: Promise<void>
  private primaryActive = false
  private keyProviderActive = false
  private fallbackKey?: Buffer
  private unavailableReason?: string
  private operation: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: ExtensionCredentialStoreOptions) {
    if (options.primary && options.keyProvider) {
      throw new Error('primary credential backend and keyProvider cannot be configured together')
    }
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.keyPath = join(options.dataDir, 'credentials', 'master.key')
    this.encryptedPath = join(options.dataDir, 'credentials', 'credentials.enc.json')
    this.encryptedFile = new AtomicJsonFile(
      this.encryptedPath,
      (value) => validateEncryptedDocument(value, options.profileId),
      false
    )
  }

  async protection(): Promise<ExtensionCredentialProtection & { backend?: string; reason?: string }> {
    await this.ensureInitialized()
    if (this.primaryActive) {
      return { mode: 'primary', degraded: false, available: true, backend: this.options.primary?.id }
    }
    if (this.keyProviderActive && this.options.keyProvider) {
      return this.options.keyProvider.osKeychain
        ? {
            mode: 'primary', degraded: false, available: true,
            backend: 'kun-os-credential-key', reason: this.options.keyProvider.reason
          }
        : {
            mode: 'encrypted-fallback', degraded: true, available: true,
            backend: 'kun-encrypted-secret-store', reason: this.options.keyProvider.reason
          }
    }
    if (this.fallbackKey) {
      return { mode: 'encrypted-fallback', degraded: true, available: true }
    }
    return {
      mode: 'unavailable', degraded: true, available: false,
      ...(this.unavailableReason ? { reason: this.unavailableReason } : {})
    }
  }

  async create(payload: ExtensionCredentialPayload): Promise<string> {
    const reference = `cred_${randomUUID()}`
    await this.set(reference, payload)
    return reference
  }

  async set(reference: string, payload: ExtensionCredentialPayload): Promise<void> {
    validateReference(reference)
    const value = serializePayload(payload)
    await this.ensureInitialized()
    if (!this.fallbackKey && !this.keyProviderActive) {
      if (this.primaryActive && this.options.primary) {
        await this.serialize(() => this.options.primary!.set(this.scopedReference(reference), value))
        return
      }
      throw new Error('protected credential storage is unavailable')
    }
    await this.serialize(() => this.writeRaw(reference, value))
  }

  async get(reference: string): Promise<ExtensionCredentialPayload | null> {
    validateReference(reference)
    await this.ensureInitialized()
    const raw = await this.readRaw(reference)
    return raw === null ? null : parsePayload(raw)
  }

  /**
   * Rotates one API key only when the protected value is still the value the
   * caller refreshed. This prevents a late OAuth response from overwriting a
   * newer user credential that was committed while the network request ran.
   */
  async compareAndSetApiKey(
    reference: string,
    expectedApiKey: string,
    apiKey: string
  ): Promise<boolean> {
    validateReference(reference)
    const expected = expectedApiKey.trim()
    const next = apiKey.trim()
    if (!expected || !next) return false
    await this.ensureInitialized()
    return this.serialize(async () => {
      const raw = await this.readRaw(reference)
      if (raw === null) return false
      const current = parsePayload(raw)
      if (current.apiKey?.trim() !== expected) return false
      await this.writeRaw(reference, serializePayload({ ...current, apiKey: next }))
      return true
    })
  }

  async delete(reference: string): Promise<void> {
    validateReference(reference)
    await this.ensureInitialized()
    if (this.primaryActive && this.options.primary) {
      await this.serialize(() => this.options.primary!.delete(this.scopedReference(reference)))
      return
    }
    if (!this.fallbackKey && !this.keyProviderActive) {
      throw new Error('protected credential storage is unavailable')
    }
    await this.serialize(async () => {
      await this.encryptedFile.update(
        () => this.emptyEncryptedDocument(),
        (document) => {
          if (!(reference in document.credentials)) return document
          const credentials = { ...document.credentials }
          delete credentials[reference]
          return { ...document, credentials }
        }
      )
    })
  }

  private async ensureInitialized(): Promise<void> {
    this.initialized ??= this.initialize()
    await this.initialized
  }

  private async initialize(): Promise<void> {
    if (this.options.primary) {
      try {
        if (await this.options.primary.isAvailable()) {
          this.primaryActive = true
          return
        }
        this.unavailableReason = 'primary credential backend is unavailable'
      } catch (error) {
        this.unavailableReason = `primary credential backend failed: ${safeError(error)}`
      }
      // A configured value backend is authoritative. Falling back to a
      // second store here would split credential generations across restart
      // boundaries when availability changes.
      return
    }
    if (this.options.keyProvider) {
      this.keyProviderActive = true
      return
    }
    try {
      await mkdir(dirname(this.keyPath), { recursive: true, mode: 0o700 })
      this.fallbackKey = await loadOrCreateKey(this.keyPath)
      await chmod(this.keyPath, 0o600).catch(() => undefined)
    } catch (error) {
      this.unavailableReason = `encrypted credential fallback failed: ${safeError(error)}`
      this.fallbackKey = undefined
    }
  }

  private async readEncryptedDocument(): Promise<EncryptedCredentialDocument> {
    return this.encryptedFile.read(() => this.emptyEncryptedDocument())
  }

  private async readRaw(reference: string): Promise<string | null> {
    if (this.primaryActive && this.options.primary) {
      return this.options.primary.get(this.scopedReference(reference))
    }
    if (!this.fallbackKey && !this.keyProviderActive) {
      throw new Error('protected credential storage is unavailable')
    }
    const document = await this.readEncryptedDocument()
    const encrypted = document.credentials[reference]
    return encrypted ? this.decryptFallback(reference, encrypted) : null
  }

  private async writeRaw(reference: string, value: string): Promise<void> {
    if (this.primaryActive && this.options.primary) {
      await this.options.primary.set(this.scopedReference(reference), value)
      return
    }
    if (!this.fallbackKey && !this.keyProviderActive) {
      throw new Error('protected credential storage is unavailable')
    }
    await this.encryptedFile.update(
      () => this.emptyEncryptedDocument(),
      (document) => ({
        ...document,
        credentials: {
          ...document.credentials,
          [reference]: this.encryptFallback(reference, value)
        }
      })
    )
  }

  private emptyEncryptedDocument(): EncryptedCredentialDocument {
    return { schemaVersion: 1, profileId: this.options.profileId, credentials: {} }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const run = this.operation.then(action, action)
    this.operation = run.then(() => undefined, () => undefined)
    return run
  }

  private scopedReference(reference: string): string {
    return `kun:${this.options.profileId}:${reference}`
  }

  private aad(reference: string): Buffer {
    return Buffer.from(`kun-extension-credential:v1:${this.options.profileId}:${reference}`, 'utf8')
  }

  private encryptFallback(reference: string, value: string): EncryptedCredential {
    if (this.keyProviderActive && this.options.keyProvider) {
      const envelope = this.options.keyProvider.encryptor.encrypt(value, this.aad(reference))
      const [prefix, version, nonce, tag, ciphertext, ...extra] = envelope.split(':')
      if (prefix !== 'enc' || version !== 'v1' || !nonce || !tag || !ciphertext || extra.length > 0) {
        throw new Error('platform credential encryptor returned an unsupported envelope')
      }
      return {
        algorithm: 'aes-256-gcm',
        nonce,
        ciphertext,
        tag,
        updatedAt: this.nowIso()
      }
    }
    if (!this.fallbackKey) throw new Error('protected credential storage is unavailable')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.fallbackKey, nonce)
    cipher.setAAD(this.aad(reference))
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return {
      algorithm: 'aes-256-gcm',
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      updatedAt: this.nowIso()
    }
  }

  private decryptFallback(reference: string, encrypted: EncryptedCredential): string {
    if (this.keyProviderActive && this.options.keyProvider) {
      return this.options.keyProvider.encryptor.decrypt(
        `enc:v1:${encrypted.nonce}:${encrypted.tag}:${encrypted.ciphertext}`,
        this.aad(reference)
      )
    }
    if (!this.fallbackKey) throw new Error('protected credential storage is unavailable')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.fallbackKey,
      Buffer.from(encrypted.nonce, 'base64')
    )
    decipher.setAAD(this.aad(reference))
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  }
}

export function redactExtensionSecrets(value: unknown, knownSecrets: readonly string[] = []): unknown {
  const secrets = knownSecrets.filter((secret) => secret.length >= 4)
  const walk = (current: unknown, key = ''): unknown => {
    if (/api.?key|access.?token|refresh.?token|client.?secret|authorization|cookie|device.?code|oauth.?code/i.test(key)) {
      return '[REDACTED]'
    }
    if (typeof current === 'string') {
      return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), current)
    }
    if (Array.isArray(current)) return current.map((entry) => walk(entry))
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        walk(child, childKey)
      ]))
    }
    return current
  }
  return walk(value)
}

async function loadOrCreateKey(path: string): Promise<Buffer> {
  try {
    const key = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64')
    if (key.length !== 32) throw new Error('credential master key has invalid length')
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }
  const key = randomBytes(32)
  try {
    const handle = await open(path, 'wx', 0o600)
    try { await handle.writeFile(`${key.toString('base64')}\n`, 'utf8') } finally { await handle.close() }
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
    const existing = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64')
    if (existing.length !== 32) throw new Error('credential master key has invalid length')
    return existing
  }
}

function serializePayload(payload: ExtensionCredentialPayload): string {
  const normalized = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  if (!Object.values(normalized).some((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('credential payload is empty')
  }
  return JSON.stringify(normalized)
}

function parsePayload(raw: string): ExtensionCredentialPayload {
  const value = JSON.parse(raw) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('stored credential payload is invalid')
  const allowed = ['apiKey', 'accessToken', 'refreshToken', 'clientSecret', 'tokenType', 'expiresAt', 'scope'] as const
  const out: ExtensionCredentialPayload = {}
  for (const key of allowed) {
    const child = (value as Record<string, unknown>)[key]
    if (child !== undefined) {
      if (typeof child !== 'string') throw new Error(`stored credential ${key} is invalid`)
      out[key] = child
    }
  }
  return out
}

function validateEncryptedDocument(value: unknown, profileId: string): EncryptedCredentialDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('credential document is invalid')
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || raw.profileId !== profileId || !raw.credentials || typeof raw.credentials !== 'object') {
    throw new Error('credential document belongs to another profile or schema')
  }
  return value as EncryptedCredentialDocument
}

function validateReference(reference: string): void {
  if (!/^cred_[a-zA-Z0-9-]+$/.test(reference)) throw new Error('invalid credential reference')
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
