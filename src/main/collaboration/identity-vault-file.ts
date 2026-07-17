import {
  argon2,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

const MEMORY_KIB = 64 * 1024
const PASSES = 3
const PARALLELISM = 1

export const DeviceIdentitySchema = z.object({
  version: z.literal(1),
  memberId: z.string().uuid(),
  deviceId: z.string().uuid(),
  signingPublicKey: z.string().min(1),
  signingPrivateKey: z.string().min(1),
  createdAt: z.iso.datetime()
}).strict()
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>

const PasswordEnvelopeSchema = z.object({
  version: z.literal(1),
  storage: z.literal('argon2id-aes-256-gcm'),
  kdf: z.object({
    salt: z.string().min(1),
    memoryKiB: z.literal(MEMORY_KIB),
    passes: z.literal(PASSES),
    parallelism: z.literal(PARALLELISM)
  }).strict(),
  cipher: z.object({
    nonce: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1)
  }).strict()
}).strict()

export class IdentityVaultError extends Error {
  constructor(
    readonly code:
      | 'identity_password_invalid'
      | 'identity_vault_corrupt'
      | 'identity_safe_storage_unavailable',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'IdentityVaultError'
  }
}

export class IdentityVaultFile {
  constructor(private readonly path: string) {}

  async loadOrCreate(password: string): Promise<DeviceIdentity> {
    requirePassword(password)
    const current = await readFile(this.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (current === null) {
      const identity = createDeviceIdentity()
      await this.write(identity, password)
      return identity
    }
    return decryptPasswordEnvelope(current, password)
  }

  async rotatePassword(currentPassword: string, nextPassword: string): Promise<void> {
    requirePassword(nextPassword)
    const identity = await this.loadOrCreate(currentPassword)
    await this.write(identity, nextPassword)
  }

  private async write(identity: DeviceIdentity, password: string): Promise<void> {
    const content = `${JSON.stringify(await encryptPasswordEnvelope(identity, password), null, 2)}\n`
    await writePrivateFileAtomic(this.path, content)
  }
}

export function createDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return DeviceIdentitySchema.parse({
    version: 1,
    memberId: randomUUID(),
    deviceId: randomUUID(),
    signingPublicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    signingPrivateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    createdAt: new Date().toISOString()
  })
}

export async function writePrivateFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

async function encryptPasswordEnvelope(identity: DeviceIdentity, password: string) {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from('kun-collaboration-identity-v1'))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(DeviceIdentitySchema.parse(identity)), 'utf8'),
    cipher.final()
  ])
  return PasswordEnvelopeSchema.parse({
    version: 1,
    storage: 'argon2id-aes-256-gcm',
    kdf: {
      salt: salt.toString('base64'),
      memoryKiB: MEMORY_KIB,
      passes: PASSES,
      parallelism: PARALLELISM
    },
    cipher: {
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
  })
}

async function decryptPasswordEnvelope(content: string, password: string): Promise<DeviceIdentity> {
  let envelope: z.infer<typeof PasswordEnvelopeSchema>
  try {
    envelope = PasswordEnvelopeSchema.parse(JSON.parse(content))
  } catch (cause) {
    throw new IdentityVaultError('identity_vault_corrupt', 'Identity vault envelope is invalid', { cause })
  }
  try {
    const key = await deriveKey(password, Buffer.from(envelope.kdf.salt, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.nonce, 'base64'))
    decipher.setAAD(Buffer.from('kun-collaboration-identity-v1'))
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.cipher.ciphertext, 'base64')),
      decipher.final()
    ])
    return DeviceIdentitySchema.parse(JSON.parse(plaintext.toString('utf8')))
  } catch (cause) {
    throw new IdentityVaultError('identity_password_invalid', 'Identity vault password is invalid', { cause })
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      parallelism: PARALLELISM,
      tagLength: 32,
      memory: MEMORY_KIB,
      passes: PASSES
    }, (error, result) => error ? reject(error) : resolve(Buffer.from(result)))
  })
}

function requirePassword(password: string): void {
  if (password.length < 12) {
    throw new IdentityVaultError('identity_password_invalid', 'Identity vault password must contain at least 12 characters')
  }
}
