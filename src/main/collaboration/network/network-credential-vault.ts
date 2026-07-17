import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'
import type { SafeStoragePort } from '../identity-vault'

const CredentialSchema = z.object({
  serverUrl: z.url(),
  serverInstanceId: z.string().min(1),
  spkiSha256: z.string().length(64),
  receiptVerifyingKey: z.string().min(1),
  memberId: z.string().min(1),
  deviceId: z.string().min(1),
  displayName: z.string().min(1),
  accessToken: z.string().min(1),
  updatedAt: z.iso.datetime().optional()
}).strict()
export type NetworkCredential = z.infer<typeof CredentialSchema>
export type NetworkCredentialSummary = Omit<NetworkCredential, 'accessToken'>

const StateSchema = z.object({ version: z.literal(1), credentials: z.array(CredentialSchema) }).strict()
const EnvelopeSchema = z.object({
  version: z.literal(1),
  storage: z.literal('safeStorage'),
  ciphertext: z.string().min(1)
}).strict()

export class NetworkCredentialVaultError extends Error {
  constructor(
    readonly code: 'network_credential_storage_unavailable' | 'network_credential_corrupt',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'NetworkCredentialVaultError'
  }
}

export class NetworkCredentialVault {
  constructor(private readonly options: { path: string; safeStorage: SafeStoragePort }) {}

  async put(input: NetworkCredential): Promise<void> {
    const credential = CredentialSchema.parse({ ...input, serverUrl: normalizeUrl(input.serverUrl) })
    const state = await this.load()
    const next = { ...credential, updatedAt: new Date().toISOString() }
    const index = state.credentials.findIndex((item) => item.serverUrl === credential.serverUrl)
    if (index >= 0) state.credentials[index] = next
    else state.credentials.push(next)
    await this.save(state)
  }

  async get(serverUrl: string): Promise<NetworkCredential | null> {
    const normalized = normalizeUrl(serverUrl)
    return (await this.load()).credentials.find((item) => item.serverUrl === normalized) ?? null
  }

  async list(): Promise<NetworkCredentialSummary[]> {
    return (await this.load()).credentials.map(({ accessToken: _accessToken, ...summary }) => summary)
  }

  private requireStorage(): void {
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      throw new NetworkCredentialVaultError(
        'network_credential_storage_unavailable',
        'Operating-system credential encryption is required for network Collaboration'
      )
    }
  }

  private async load(): Promise<z.infer<typeof StateSchema>> {
    this.requireStorage()
    const content = await readFile(this.options.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (content === null) return { version: 1, credentials: [] }
    try {
      const envelope = EnvelopeSchema.parse(JSON.parse(content))
      const plaintext = this.options.safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
      return StateSchema.parse(JSON.parse(plaintext))
    } catch (cause) {
      throw new NetworkCredentialVaultError('network_credential_corrupt', 'Network Collaboration credentials are invalid', { cause })
    }
  }

  private async save(state: z.infer<typeof StateSchema>): Promise<void> {
    this.requireStorage()
    const ciphertext = this.options.safeStorage.encryptString(JSON.stringify(StateSchema.parse(state)))
    const envelope = EnvelopeSchema.parse({
      version: 1,
      storage: 'safeStorage',
      ciphertext: ciphertext.toString('base64')
    })
    await writePrivateFileAtomic(this.options.path, `${JSON.stringify(envelope, null, 2)}\n`)
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new TypeError('Collaboration server must use HTTPS')
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}
