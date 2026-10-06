import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { assertManagerAtomicJsonPath, AtomicJsonFile } from '../extensions/atomic-json.js'
import { GatewayClientPolicySchema, legacyGatewayClientPolicy, type GatewayClientPolicy } from '../contracts/gateway-client-policy.js'
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
  rotatedAt?: string
  scopeMode?: 'scoped' | 'legacy-unrestricted'
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
  private readonly keyFile: AtomicJsonFile<StoredGatewayCredential | null>
  private readonly clientFile: AtomicJsonFile<{ schemaVersion: 1; encryptedClients: string } | null>

  constructor(
    dataDir: string,
    private readonly encryptor: SecretEncryptor,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {
    this.directory = join(dataDir, 'model-gateway')
    this.path = join(this.directory, 'api-key.enc.json')
    this.clientsPath = join(this.directory, 'clients.enc.json')
    assertManagerAtomicJsonPath(this.path)
    assertManagerAtomicJsonPath(this.clientsPath)
    this.keyFile = new AtomicJsonFile(this.path, (value) => parseStoredCredential(JSON.stringify(value)), false)
    this.clientFile = new AtomicJsonFile(this.clientsPath, (value) => {
      const stored = value as { schemaVersion?: number; encryptedClients?: unknown } | null
      if (stored?.schemaVersion !== 1 || typeof stored.encryptedClients !== 'string') throw new Error('stored gateway clients are malformed')
      return { schemaVersion: 1 as const, encryptedClients: stored.encryptedClients }
    }, false)
  }

  async initialize(): Promise<void> {
    await this.initializeClients()
    const stored = await this.keyFile.read(() => null)
    if (!stored) return
    const key = this.encryptor.decrypt(stored.encryptedKey, GATEWAY_KEY_AAD)
    if (!isGatewayKey(key)) throw new Error('stored local gateway key is invalid')
    this.key = key
    this.metadata = {
      createdAt: stored.createdAt,
      ...(stored.rotatedAt ? { rotatedAt: stored.rotatedAt } : {})
    }
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

  defaultClientPolicy(clientId: string): GatewayClientPolicy {
    const client = this.clients.find((entry) => entry.clientId === clientId)
    return client?.scopeMode === 'scoped' ? GatewayClientPolicySchema.parse({}) : legacyGatewayClientPolicy()
  }

  createClient(name: string, scopeMode: 'scoped' | 'legacy-unrestricted' = 'scoped'): Promise<{ client: GatewayClient; key: string }> {
    return this.serialize(async () => {
      if (!validGatewayClientName(name)) throw new Error('Client name must be 1-80 characters without control characters.')
      const client: GatewayClient = {
        clientId: `gc_${randomUUID()}`, name: name.trim(), createdAt: this.nowIso(), scopeMode
      }
      const key = generateGatewayKey()
      await this.updateClients((current) => {
        if (current.length >= MAX_CLIENT_RECORDS) throw new Error('Gateway client record limit reached.')
        return [...current, { ...client, key }]
      })
      return { client, key }
    })
  }

  revokeClient(clientId: string): Promise<boolean> {
    return this.serialize(async () => {
      let revoked = false
      await this.updateClients((current) => {
        const client = current.find((entry) => entry.clientId === clientId)
        if (!client || client.revokedAt) return current
        revoked = true
        return current.map((entry) => entry.clientId === clientId
          ? { ...entry, key: undefined, revokedAt: this.nowIso() } : entry)
      })
      return revoked
    })
  }

  rotateClient(clientId: string): Promise<{ client: GatewayClient; key: string }> {
    return this.serialize(async () => {
      const key = generateGatewayKey()
      await this.updateClients((current) => {
        const client = current.find((entry) => entry.clientId === clientId)
        if (!client || client.revokedAt) throw new Error('Gateway client is unavailable')
        return current.map((entry) => entry.clientId === clientId ? { ...entry, key, rotatedAt: this.nowIso() } : entry)
      })
      return { key, client: this.listClients().find((client) => client.clientId === clientId)! }
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
      await this.keyFile.delete()
      this.key = null
      this.metadata = {}
      return revoked
    })
  }

  reveal(): string | null {
    return this.key
  }

  private async initializeClients(): Promise<void> {
    const stored = await this.clientFile.read(() => null)
    if (stored) this.clients = this.decodeClients(stored.encryptedClients)
  }

  private decodeClients(ciphertext: string): StoredGatewayClient[] {
    const clients: unknown = JSON.parse(this.encryptor.decrypt(ciphertext, GATEWAY_CLIENTS_AAD))
    if (!Array.isArray(clients) || clients.length > MAX_CLIENT_RECORDS || !clients.every(isStoredClient) ||
      new Set(clients.map((client) => client.clientId)).size !== clients.length) {
      throw new Error('stored gateway clients are malformed')
    }
    return clients
  }

  private async updateClients(update: (current: StoredGatewayClient[]) => StoredGatewayClient[]): Promise<void> {
    const stored = await this.clientFile.update(() => null, (previous) => {
      const current = previous ? this.decodeClients(previous.encryptedClients) : []
      const next = update(current)
      if (next === current && previous) return previous
      return { schemaVersion: 1 as const, encryptedClients: this.encryptor.encrypt(JSON.stringify(next), GATEWAY_CLIENTS_AAD) }
    })
    this.clients = stored ? this.decodeClients(stored.encryptedClients) : []
  }

  private async persist(
    key: string,
    metadata: { createdAt: string; rotatedAt?: string }
  ): Promise<void> {
    const stored: StoredGatewayCredential = {
      schemaVersion: 1,
      encryptedKey: this.encryptor.encrypt(key, GATEWAY_KEY_AAD),
      ...metadata
    }
    await this.keyFile.write(stored)
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

function isStoredClient(value: unknown): value is StoredGatewayClient {
  if (!value || typeof value !== 'object') return false
  const client = value as Partial<StoredGatewayClient>
  return typeof client.clientId === 'string' && /^gc_[a-f0-9-]{36}$/.test(client.clientId) &&
    (client.scopeMode === undefined || client.scopeMode === 'scoped' || client.scopeMode === 'legacy-unrestricted') &&
    validGatewayClientName(client.name) && typeof client.createdAt === 'string' &&
    (client.revokedAt === undefined
      ? typeof client.key === 'string' && isGatewayKey(client.key)
      : typeof client.revokedAt === 'string' && client.key === undefined)
}
