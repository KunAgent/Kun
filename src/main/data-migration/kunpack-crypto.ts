import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as nodeScrypt
} from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import type { DataMigrationEncryption } from '../../shared/data-migration'
import { DATA_MIGRATION_DEFAULT_FRAME_BYTES } from '../../shared/data-migration'

export const KUNPACK_KEY_BYTES = 32
export const KUNPACK_NONCE_PREFIX_BYTES = 8
export const KUNPACK_AUTH_TAG_BYTES = 16
export const KUNPACK_FRAME_HEADER_BYTES = 8
export const KUNPACK_SCRYPT_DEFAULTS = Object.freeze({
  cost: 32_768,
  blockSize: 8,
  parallelization: 1,
  maxMemoryBytes: 128 * 1024 * 1024
})

type PassphraseEncryption = Extract<DataMigrationEncryption, { mode: 'passphrase' }>

export function createKunpackPassphraseEncryption(
  random: (size: number) => Buffer = randomBytes
): PassphraseEncryption {
  return {
    mode: 'passphrase',
    algorithm: 'aes-256-gcm-framed',
    kdf: 'scrypt',
    saltBase64: random(16).toString('base64'),
    noncePrefixBase64: random(KUNPACK_NONCE_PREFIX_BYTES).toString('base64'),
    frameBytes: DATA_MIGRATION_DEFAULT_FRAME_BYTES,
    cost: KUNPACK_SCRYPT_DEFAULTS.cost,
    blockSize: KUNPACK_SCRYPT_DEFAULTS.blockSize,
    parallelization: KUNPACK_SCRYPT_DEFAULTS.parallelization
  }
}

export function validateKunpackPassphraseEncryption(settings: PassphraseEncryption): void {
  if (settings.algorithm !== 'aes-256-gcm-framed' || settings.kdf !== 'scrypt') {
    throw new Error('unsupported Kunpack encryption settings')
  }
  if (!isPowerOfTwo(settings.cost) || settings.cost < 16_384 || settings.cost > 1_048_576) {
    throw new Error('invalid Kunpack scrypt cost')
  }
  if (!Number.isInteger(settings.blockSize) || settings.blockSize < 1 || settings.blockSize > 32) {
    throw new Error('invalid Kunpack scrypt block size')
  }
  if (!Number.isInteger(settings.parallelization) || settings.parallelization < 1 || settings.parallelization > 16) {
    throw new Error('invalid Kunpack scrypt parallelization')
  }
  if (!Number.isInteger(settings.frameBytes) || settings.frameBytes < 64 * 1024 || settings.frameBytes > 64 * 1024 * 1024) {
    throw new Error('invalid Kunpack encryption frame size')
  }
  if (decodeExactBase64(settings.saltBase64, 'salt').length < 16) {
    throw new Error('invalid Kunpack encryption salt')
  }
  if (decodeExactBase64(settings.noncePrefixBase64, 'nonce prefix').length !== KUNPACK_NONCE_PREFIX_BYTES) {
    throw new Error('invalid Kunpack encryption nonce prefix')
  }
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0
}

function decodeExactBase64(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (!value || decoded.toString('base64') !== value) throw new Error(`invalid Kunpack ${label}`)
  return decoded
}

export async function deriveKunpackPassphraseKey(
  passphrase: string,
  settings: PassphraseEncryption
): Promise<Buffer> {
  validateKunpackPassphraseEncryption(settings)
  if (!passphrase) throw new Error('Kunpack passphrase is required')
  const salt = decodeExactBase64(settings.saltBase64, 'salt')
  const minimumMemory = 128 * settings.cost * settings.blockSize + 1024 * settings.blockSize
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(passphrase, salt, KUNPACK_KEY_BYTES, {
      N: settings.cost,
      r: settings.blockSize,
      p: settings.parallelization,
      maxmem: Math.max(KUNPACK_SCRYPT_DEFAULTS.maxMemoryBytes, minimumMemory * 2)
    }, (error, key) => {
      if (error) reject(error)
      else resolve(Buffer.from(key))
    })
  })
}

export type KunpackFramedEncryptionResult = {
  plainBytes: number
  encryptedBytes: number
  frameCount: number
}

export async function encryptKunpackFileToHandle(input: {
  inputPath: string
  output: import('node:fs/promises').FileHandle
  outputPosition: number
  passphrase: string
  settings: PassphraseEncryption
  authenticatedHeader: Buffer
}): Promise<KunpackFramedEncryptionResult> {
  validateKunpackPassphraseEncryption(input.settings)
  const key = await deriveKunpackPassphraseKey(input.passphrase, input.settings)
  const noncePrefix = decodeExactBase64(input.settings.noncePrefixBase64, 'nonce prefix')
  const source = await open(input.inputPath, 'r')
  const plain = Buffer.allocUnsafe(input.settings.frameBytes)
  let sourcePosition = 0
  let outputPosition = input.outputPosition
  let frameIndex = 0
  try {
    while (true) {
      const { bytesRead } = await source.read(plain, 0, plain.length, sourcePosition)
      if (bytesRead === 0) break
      if (frameIndex > 0xffff_ffff) throw new Error('Kunpack encryption frame counter exhausted')
      const frameHeader = frameHeaderFor(bytesRead, frameIndex)
      const nonce = nonceFor(noncePrefix, frameIndex)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.concat([input.authenticatedHeader, frameHeader]))
      const ciphertext = Buffer.concat([cipher.update(plain.subarray(0, bytesRead)), cipher.final()])
      const tag = cipher.getAuthTag()
      await writeAll(input.output, frameHeader, outputPosition)
      outputPosition += frameHeader.length
      await writeAll(input.output, ciphertext, outputPosition)
      outputPosition += ciphertext.length
      await writeAll(input.output, tag, outputPosition)
      outputPosition += tag.length
      sourcePosition += bytesRead
      frameIndex += 1
    }
    return {
      plainBytes: sourcePosition,
      encryptedBytes: outputPosition - input.outputPosition,
      frameCount: frameIndex
    }
  } finally {
    plain.fill(0)
    key.fill(0)
    await source.close()
  }
}

export async function decryptKunpackFramesToFile(input: {
  packagePath: string
  payloadOffset: number
  outputPath: string
  passphrase: string
  settings: PassphraseEncryption
  authenticatedHeader: Buffer
}): Promise<KunpackFramedEncryptionResult> {
  validateKunpackPassphraseEncryption(input.settings)
  const key = await deriveKunpackPassphraseKey(input.passphrase, input.settings)
  const noncePrefix = decodeExactBase64(input.settings.noncePrefixBase64, 'nonce prefix')
  const source = await open(input.packagePath, 'r')
  const output = await open(input.outputPath, 'wx', 0o600)
  const sourceStats = await source.stat()
  let sourcePosition = input.payloadOffset
  let outputPosition = 0
  let expectedFrameIndex = 0
  try {
    while (sourcePosition < sourceStats.size) {
      const frameHeader = await readExact(source, KUNPACK_FRAME_HEADER_BYTES, sourcePosition)
      sourcePosition += frameHeader.length
      const cipherBytes = frameHeader.readUInt32BE(0)
      const frameIndex = frameHeader.readUInt32BE(4)
      if (frameIndex !== expectedFrameIndex) throw new Error('Kunpack encryption frame sequence is invalid')
      if (cipherBytes < 1 || cipherBytes > input.settings.frameBytes) {
        throw new Error('Kunpack encrypted frame exceeds declared size')
      }
      const ciphertext = await readExact(source, cipherBytes, sourcePosition)
      sourcePosition += ciphertext.length
      const tag = await readExact(source, KUNPACK_AUTH_TAG_BYTES, sourcePosition)
      sourcePosition += tag.length
      const nonce = nonceFor(noncePrefix, frameIndex)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAAD(Buffer.concat([input.authenticatedHeader, frameHeader]))
      decipher.setAuthTag(tag)
      let plaintext: Buffer
      try {
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      } catch (error) {
        throw new Error('Kunpack passphrase or authenticated payload is invalid', { cause: error })
      }
      await writeAll(output, plaintext, outputPosition)
      outputPosition += plaintext.length
      plaintext.fill(0)
      expectedFrameIndex += 1
    }
    await output.sync()
    return {
      plainBytes: outputPosition,
      encryptedBytes: sourcePosition - input.payloadOffset,
      frameCount: expectedFrameIndex
    }
  } catch (error) {
    await output.close().catch(() => undefined)
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    key.fill(0)
    await source.close()
    await output.close().catch(() => undefined)
  }
}

function frameHeaderFor(length: number, frameIndex: number): Buffer {
  const header = Buffer.allocUnsafe(KUNPACK_FRAME_HEADER_BYTES)
  header.writeUInt32BE(length, 0)
  header.writeUInt32BE(frameIndex, 4)
  return header
}

function nonceFor(prefix: Buffer, frameIndex: number): Buffer {
  const nonce = Buffer.allocUnsafe(12)
  prefix.copy(nonce, 0)
  nonce.writeUInt32BE(frameIndex, KUNPACK_NONCE_PREFIX_BYTES)
  return nonce
}

async function readExact(
  handle: import('node:fs/promises').FileHandle,
  length: number,
  position: number
): Promise<Buffer> {
  const output = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Error('Kunpack encrypted payload is truncated')
    offset += bytesRead
  }
  return output
}

async function writeAll(
  handle: import('node:fs/promises').FileHandle,
  buffer: Buffer,
  position: number
): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset)
    if (bytesWritten === 0) throw new Error('failed to write Kunpack payload')
    offset += bytesWritten
  }
}
