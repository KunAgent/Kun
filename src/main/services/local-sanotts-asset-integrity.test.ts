import { createHash } from 'node:crypto'
import { createReadStream, writeFileSync } from 'node:fs'
import { mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

import { fileSha256, readVerifiedAssetSize } from './local-sanotts-asset-integrity'

const payload = Buffer.from('verified-voice-asset')
const expected = { sizeBytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') }

describe('sanoTTS on-disk integrity', () => {
  let rootDir = ''
  let path = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-sanotts-integrity-'))
    path = join(rootDir, 'front.bin')
    vi.mocked(createReadStream).mockClear()
  })

  afterEach(async () => {
    vi.mocked(createReadStream).mockReset()
    await rm(rootDir, { recursive: true, force: true })
  })

  it('rejects missing files, directories, partial bytes and same-size corrupt bytes', async () => {
    expect(await readVerifiedAssetSize(path, expected)).toBeNull()
    expect(await readVerifiedAssetSize(rootDir, expected)).toBeNull()
    await writeFile(path, payload.subarray(1))
    expect(await readVerifiedAssetSize(path, expected)).toBeNull()
    await writeFile(path, Buffer.alloc(payload.length, 1))
    expect(await readVerifiedAssetSize(path, expected)).toBeNull()
    await writeFile(path, payload)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
  })

  it('reuses successful SHA-256 checks only for the same full file fingerprint', async () => {
    await writeFile(path, payload)
    await utimes(path, 1_700_000_000, 1_700_000_000)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    const before = await stat(path)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(createReadStream).toHaveBeenCalledTimes(1)

    await writeFile(path, Buffer.alloc(payload.length, 2))
    await utimes(path, before.atime, before.mtime)
    expect(await readVerifiedAssetSize(path, expected)).toBeNull()
    expect(createReadStream).toHaveBeenCalledTimes(2)

    const replacement = join(rootDir, 'replacement.bin')
    await writeFile(replacement, payload)
    await utimes(replacement, before.atime, before.mtime)
    await rename(replacement, path)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(createReadStream).toHaveBeenCalledTimes(3)
  })

  it('includes the expected digest and absolute path in the verification cache', async () => {
    await writeFile(path, payload)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(await readVerifiedAssetSize(path, { ...expected, sha256: '0'.repeat(64) })).toBeNull()
    const otherPath = join(rootDir, 'other.bin')
    await writeFile(otherPath, Buffer.alloc(payload.length, 1))
    expect(await readVerifiedAssetSize(otherPath, expected)).toBeNull()
    expect(createReadStream).toHaveBeenCalledTimes(3)
  })

  it('does not accept a file modified while hashing, even if the read bytes matched', async () => {
    await writeFile(path, payload)
    const original = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(createReadStream).mockImplementationOnce((...args) => {
      const stream = original.createReadStream(...args)
      stream.once('data', () => writeFileSync(path, Buffer.alloc(payload.length, 3)))
      return stream
    })
    expect(await readVerifiedAssetSize(path, expected)).toBeNull()
  })

  it('honors cancellation before and during file hashing', async () => {
    await writeFile(path, Buffer.alloc(128 * 1024, 1))
    const controller = new AbortController()
    const original = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(createReadStream).mockImplementationOnce((...args) => {
      const stream = original.createReadStream(...args)
      stream.once('data', () => controller.abort(new Error('stop verification')))
      return stream
    })
    await expect(fileSha256(path, controller.signal)).rejects.toThrow()
    await expect(readVerifiedAssetSize(path, expected, controller.signal)).rejects.toThrow('stop verification')
  })
})
