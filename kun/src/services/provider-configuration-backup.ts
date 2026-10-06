import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { z } from 'zod'
import { CustomHeadersSchema } from '../contracts/custom-headers.js'

const MAX_BYTES = 8 * 1024 * 1024
const passphrase = z.string().min(12).max(1_024)
export const ProviderSecretBindingSchema = z.discriminatedUnion('kind', [
  z.object({ slotId: z.string().min(1).max(256), kind: z.literal('credential'),
    credential: z.string().min(1).max(64 * 1024).optional(), sourceConnectionId: z.string().min(1).max(128).optional() }).strict().refine((value) => Boolean(value.credential) !== Boolean(value.sourceConnectionId), 'Bind a credential value or one existing account'),
  z.object({ slotId: z.string().min(1).max(256), kind: z.literal('headers'), headers: CustomHeadersSchema }).strict()
])
export type ProviderSecretBinding = z.infer<typeof ProviderSecretBindingSchema>
const Payload = z.object({ schemaVersion: z.literal(1), exchange: z.unknown(),
  bindings: z.array(ProviderSecretBindingSchema).max(1_000) }).strict()
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(Math.ceil(MAX_BYTES * 4 / 3) + 4)
export const ProviderEncryptedBackupSchema = z.object({
  format: z.literal('kun-provider-backup'), version: z.literal(1), algorithm: z.literal('aes-256-gcm'),
  kdf: z.literal('scrypt'), salt: base64, nonce: base64, tag: base64, ciphertext: base64
}).strict()
export type ProviderEncryptedBackup = z.infer<typeof ProviderEncryptedBackupSchema>
const AAD = Buffer.from('kun-provider-backup:v1:aes-256-gcm:scrypt')
async function derive(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(value, salt, 32,
    { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)))
}
function decode(value: string, length?: number): Buffer {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) throw new Error('Invalid encrypted provider backup')
  return bytes
}
/** Portable backups use their own password-derived key; platform credential keys never leave this host. */
export async function encryptProviderBackup(exchange: unknown, bindings: ProviderSecretBinding[], password: unknown): Promise<ProviderEncryptedBackup> {
  const text = Buffer.from(JSON.stringify(Payload.parse({ schemaVersion: 1, exchange, bindings })))
  if (text.length > MAX_BYTES) throw new Error('Encrypted provider backup exceeds the 8 MiB limit')
  const salt = randomBytes(16), nonce = randomBytes(12), key = await derive(passphrase.parse(password), salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(AAD)
    const ciphertext = Buffer.concat([cipher.update(text), cipher.final()])
    return { format: 'kun-provider-backup', version: 1, algorithm: 'aes-256-gcm', kdf: 'scrypt',
      salt: salt.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  } finally { key.fill(0); text.fill(0) }
}
export async function decryptProviderBackup(value: unknown, password: unknown) {
  const envelope = ProviderEncryptedBackupSchema.parse(value)
  const salt = decode(envelope.salt, 16), nonce = decode(envelope.nonce, 12), tag = decode(envelope.tag, 16)
  const ciphertext = decode(envelope.ciphertext)
  if (ciphertext.length > MAX_BYTES) throw new Error('Encrypted provider backup exceeds the 8 MiB limit')
  const key = await derive(passphrase.parse(password), salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(AAD); decipher.setAuthTag(tag)
    let plaintext: Buffer
    try { plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]) }
    catch { throw new Error('Provider backup password or authentication tag is invalid') }
    try { return Payload.parse(JSON.parse(plaintext.toString('utf8'))) }
    finally { plaintext.fill(0) }
  } finally { key.fill(0) }
}
