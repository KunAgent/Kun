import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DataMigrationEncryption } from '../../shared/data-migration'
import {
  decryptKunpackFramesToFile,
  deriveKunpackPassphraseKey,
  encryptKunpackFileToHandle,
  validateKunpackPassphraseEncryption
} from './kunpack-crypto'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const PUBLISHED_VECTOR = Object.freeze({
  passphrase: 'correct horse battery staple',
  authenticatedHeaderUtf8: '{"test":"vector"}\n',
  plaintextUtf8: 'Kunpack fixed vector\n',
  derivedKeyHex: 'd7590aca2c9801cf06eeba772a69dc31ce3862591d96522ac4e6bba6ad1f31a5',
  encryptedFrameHex: '0000001500000000cd1ecc8cb2d24a909cd8b8c1de5ec8a7196e56fcb64d1efe022ba47bb00d8496761460871d'
})

const VECTOR_SETTINGS: Extract<DataMigrationEncryption, { mode: 'passphrase' }> = {
  mode: 'passphrase',
  algorithm: 'aes-256-gcm-framed',
  kdf: 'scrypt',
  saltBase64: 'AAECAwQFBgcICQoLDA0ODw==',
  noncePrefixBase64: 'EBESExQVFhc=',
  frameBytes: 64 * 1024,
  cost: 16_384,
  blockSize: 8,
  parallelization: 1
}

describe('Kunpack framed encryption published vector', () => {
  it('derives the expected scrypt key and independently authenticated frame bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kunpack-crypto-test-'))
    temporaryDirectories.push(root)
    const plainPath = join(root, 'plain.bin')
    const encryptedPath = join(root, 'encrypted.bin')
    const decryptedPath = join(root, 'decrypted.bin')
    await writeFile(plainPath, PUBLISHED_VECTOR.plaintextUtf8)

    const key = await deriveKunpackPassphraseKey(PUBLISHED_VECTOR.passphrase, VECTOR_SETTINGS)
    expect(key.toString('hex')).toBe(PUBLISHED_VECTOR.derivedKeyHex)
    key.fill(0)

    const output = await open(encryptedPath, 'wx', 0o600)
    try {
      await encryptKunpackFileToHandle({
        inputPath: plainPath,
        output,
        outputPosition: 0,
        passphrase: PUBLISHED_VECTOR.passphrase,
        settings: VECTOR_SETTINGS,
        authenticatedHeader: Buffer.from(PUBLISHED_VECTOR.authenticatedHeaderUtf8)
      })
    } finally {
      await output.close()
    }
    expect((await readFile(encryptedPath)).toString('hex')).toBe(PUBLISHED_VECTOR.encryptedFrameHex)

    await decryptKunpackFramesToFile({
      packagePath: encryptedPath,
      payloadOffset: 0,
      outputPath: decryptedPath,
      passphrase: PUBLISHED_VECTOR.passphrase,
      settings: VECTOR_SETTINGS,
      authenticatedHeader: Buffer.from(PUBLISHED_VECTOR.authenticatedHeaderUtf8)
    })
    expect(await readFile(decryptedPath, 'utf8')).toBe(PUBLISHED_VECTOR.plaintextUtf8)
  })

  it('rejects invalid or excessive KDF and frame parameters', () => {
    expect(() => validateKunpackPassphraseEncryption({ ...VECTOR_SETTINGS, cost: 12_345 })).toThrow('scrypt cost')
    expect(() => validateKunpackPassphraseEncryption({ ...VECTOR_SETTINGS, frameBytes: 1 })).toThrow('frame size')
    expect(() => validateKunpackPassphraseEncryption({ ...VECTOR_SETTINGS, noncePrefixBase64: 'AA==' })).toThrow('nonce prefix')
  })
})
