import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SecretEncryptor = {
  encrypt: (plaintext: string, additionalAuthenticatedData?: string | Buffer) => string
  decrypt: (blob: string, additionalAuthenticatedData?: string | Buffer) => string
}

const ALGORITHM = 'aes-256-gcm'
const ENVELOPE_PREFIX = 'enc:v1:'

/** Build an AES-256-GCM encryptor from a 32-byte key. */
export function createAesEncryptor(key: Buffer): SecretEncryptor {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes')
  return {
    encrypt: (plaintext: string, additionalAuthenticatedData?: string | Buffer): string => {
      const iv = randomBytes(12)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      if (additionalAuthenticatedData !== undefined) {
        cipher.setAAD(asBuffer(additionalAuthenticatedData))
      }
      const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return `${ENVELOPE_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
    },
    decrypt: (blob: string, additionalAuthenticatedData?: string | Buffer): string => {
      if (!blob.startsWith(ENVELOPE_PREFIX)) return blob
      const [, , ivB64, tagB64, dataB64] = blob.split(':')
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
      if (additionalAuthenticatedData !== undefined) {
        decipher.setAAD(asBuffer(additionalAuthenticatedData))
      }
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final()
      ]).toString('utf8')
    }
  }
}

/**
 * Encrypt with the primary key while retaining read compatibility with a
 * credential generation written by a temporary fallback key.
 */
export function createCompatibleEncryptor(
  primary: SecretEncryptor,
  fallback: SecretEncryptor
): SecretEncryptor {
  return {
    encrypt: (plaintext, additionalAuthenticatedData) =>
      primary.encrypt(plaintext, additionalAuthenticatedData),
    decrypt: (blob, additionalAuthenticatedData) => {
      if (!isEncryptedEnvelope(blob)) return blob
      try {
        return primary.decrypt(blob, additionalAuthenticatedData)
      } catch (primaryError) {
        try {
          return fallback.decrypt(blob, additionalAuthenticatedData)
        } catch {
          throw primaryError
        }
      }
    }
  }
}

export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX)
}

function asBuffer(value: string | Buffer): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value
}
