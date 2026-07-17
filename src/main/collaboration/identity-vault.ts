import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  createDeviceIdentity,
  DeviceIdentitySchema,
  IdentityVaultError,
  IdentityVaultFile,
  writePrivateFileAtomic,
  type DeviceIdentity
} from './identity-vault-file'

export type SafeStoragePort = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

const SafeStorageEnvelopeSchema = z.object({
  version: z.literal(1),
  storage: z.literal('safeStorage'),
  ciphertext: z.string().min(1)
}).strict()

export class IdentityVault {
  constructor(private readonly options: {
    path: string
    safeStorage: SafeStoragePort
    passwordProvider?: () => Promise<string>
  }) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    const content = await readFile(this.options.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (content !== null) {
      const storage = parseStorageKind(content)
      if (storage === 'safeStorage') return this.readSafeStorage(content)
      return this.readPasswordFallback()
    }
    if (this.options.safeStorage.isEncryptionAvailable()) {
      const identity = createDeviceIdentity()
      await this.writeSafeStorage(identity)
      return identity
    }
    return this.readPasswordFallback()
  }

  private async readSafeStorage(content: string): Promise<DeviceIdentity> {
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      throw new IdentityVaultError(
        'identity_safe_storage_unavailable',
        'The operating system credential vault is unavailable'
      )
    }
    try {
      const envelope = SafeStorageEnvelopeSchema.parse(JSON.parse(content))
      const plaintext = this.options.safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
      return DeviceIdentitySchema.parse(JSON.parse(plaintext))
    } catch (cause) {
      if (cause instanceof IdentityVaultError) throw cause
      throw new IdentityVaultError('identity_vault_corrupt', 'safeStorage identity data is invalid', { cause })
    }
  }

  private async writeSafeStorage(identity: DeviceIdentity): Promise<void> {
    const ciphertext = this.options.safeStorage.encryptString(JSON.stringify(identity))
    const envelope = SafeStorageEnvelopeSchema.parse({
      version: 1,
      storage: 'safeStorage',
      ciphertext: ciphertext.toString('base64')
    })
    await writePrivateFileAtomic(this.options.path, `${JSON.stringify(envelope, null, 2)}\n`)
  }

  private async readPasswordFallback(): Promise<DeviceIdentity> {
    if (!this.options.passwordProvider) {
      throw new IdentityVaultError(
        'identity_safe_storage_unavailable',
        'A password is required because safeStorage is unavailable'
      )
    }
    return new IdentityVaultFile(this.options.path).loadOrCreate(await this.options.passwordProvider())
  }
}

function parseStorageKind(content: string): 'safeStorage' | 'argon2id-aes-256-gcm' {
  try {
    const value: unknown = JSON.parse(content)
    if (value && typeof value === 'object') {
      const storage = (value as { storage?: unknown }).storage
      if (storage === 'safeStorage' || storage === 'argon2id-aes-256-gcm') return storage
    }
  } catch {
    // Use the stable corrupt-vault error below.
  }
  throw new IdentityVaultError('identity_vault_corrupt', 'Identity vault storage envelope is invalid')
}
