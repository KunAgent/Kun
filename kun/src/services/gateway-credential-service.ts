import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { SecretEncryptor } from '../security/secret-store.js'

const GATEWAY_KEY_AAD = 'kun-local-model-gateway-key:v1'
const GATEWAY_CLIENTS_AAD = 'kun-local-model-gateway-clients:v1'
const MAX_CLIENT_RECORDS = 1_024

export type GatewayClientIdentity = {
  clientId: string
  name: string
  credentialKind: 'legacy' | 'client'
}

export type GatewayClient = {
  clientId: string
  name: string
  createdAt: string
  revokedAt?: string
}

type StoredGatewayClient = GatewayClient & { key?: string }

export function validGatewayClientName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.trim().length <= 80 && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

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
  readonly clientsPath: string
  private clients: StoredGatewayClient[] = []
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
    this.clientsPath = join(this.directory, 'clients.enc.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    await this.initializeClients()
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

  hasActiveCredentials(): boolean {
    return this.key !== null || this.clients.some((client) => Boolean(client.key) && !client.revokedAt)
  }

  identify(candidate: string | null): GatewayClientIdentity | null {
    if (!candidate) return null
    const candidateDigest = digest(candidate)
    let identity: GatewayClientIdentity | null = this.key && timingSafeEqual(candidateDigest, digest(this.key))
      ? { clientId: 'legacy', name: 'Shared gateway key', credentialKind: 'legacy' }
      : null
    for (const client of this.clients) {
      if (!client.key || client.revokedAt) continue
      if (timingSafeEqual(candidateDigest, digest(client.key))) {
        identity = { clientId: client.clientId, name: client.name, credentialKind: 'client' }
      }
    }
    return identity
  }

  verify(candidate: string | null): boolean {
    return this.identify(candidate) !== null
  }

  listClients(): GatewayClient[] {
    return this.clients.map(({ key: _key, ...client }) => ({ ...client }))
  }

  createClient(name: string): Promise<{ client: GatewayClient; key: string }> {
    return this.serialize(async () => {
      if (!validGatewayClientName(name)) throw new Error('Client name must be 1-80 characters without control characters.')
      if (this.clients.length >= MAX_CLIENT_RECORDS) throw new Error('Gateway client record limit reached.')
      const client: GatewayClient = {
        clientId: `gc_${randomUUID()}`, name: name.trim(), createdAt: this.nowIso()
      }
      const key = generateGatewayKey()
      const next = [...this.clients, { ...client, key }]
      await this.persistClients(next)
      this.clients = next
      return { client, key }
    })
  }

  revokeClient(clientId: string): Promise<boolean> {
    return this.serialize(async () => {
      const client = this.clients.find((entry) => entry.clientId === clientId)
      if (!client || client.revokedAt) return false
      const next = this.clients.map((entry) => entry.clientId === clientId
        ? { clientId: entry.clientId, name: entry.name, createdAt: entry.createdAt, revokedAt: this.nowIso() }
        : entry)
      await this.persistClients(next)
      this.clients = next
      return true
    })
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

  private async initializeClients(): Promise<void> {
    let raw: string
    try { raw = await readFile(this.clientsPath, 'utf8') } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    const stored = JSON.parse(raw) as { schemaVersion?: number; encryptedClients?: unknown }
    if (stored.schemaVersion !== 1 || typeof stored.encryptedClients !== 'string') {
      throw new Error('stored gateway clients are malformed')
    }
    const clients: unknown = JSON.parse(this.encryptor.decrypt(stored.encryptedClients, GATEWAY_CLIENTS_AAD))
    if (!Array.isArray(clients) || clients.length > MAX_CLIENT_RECORDS || !clients.every(isStoredClient) ||
      new Set(clients.map((client) => client.clientId)).size !== clients.length) {
      throw new Error('stored gateway clients are malformed')
    }
    this.clients = clients
    await chmod(this.clientsPath, 0o600)
  }

  private async persistClients(clients: StoredGatewayClient[]): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const stored = {
      schemaVersion: 1,
      encryptedClients: this.encryptor.encrypt(JSON.stringify(clients), GATEWAY_CLIENTS_AAD)
    }
    await atomicWriteFile(this.clientsPath, `${JSON.stringify(stored)}\n`, {
      durable: true, allowDirectWriteFallback: false
    })
    await chmod(this.clientsPath, 0o600)
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
    await atomicWriteFile(this.path, `${JSON.stringify(stored, null, 2)}\n`, { durable: true, allowDirectWriteFallback: false })
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

function isStoredClient(value: unknown): value is StoredGatewayClient {
  if (!value || typeof value !== 'object') return false
  const client = value as Partial<StoredGatewayClient>
  return typeof client.clientId === 'string' && /^gc_[a-f0-9-]{36}$/.test(client.clientId) &&
    validGatewayClientName(client.name) && typeof client.createdAt === 'string' &&
    (client.revokedAt === undefined
      ? typeof client.key === 'string' && isGatewayKey(client.key)
      : typeof client.revokedAt === 'string' && client.key === undefined)
}
