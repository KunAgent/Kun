import { createHash } from 'node:crypto'
import { createReadStream, writeFileSync } from 'node:fs'
import { mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, platform: vi.fn(actual.platform) }
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
    vi.mocked(stat).mockReset()
    vi.mocked(platform).mockReset()
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

  it.each(['linux', 'darwin'] as const)('reuses successful SHA-256 checks for unchanged files on %s', async (os) => {
    vi.mocked(platform).mockReturnValue(os)
    await writeFile(path, payload)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(createReadStream).toHaveBeenCalledTimes(1)
  })

  it('rejects same-length corruption with restored mtime and checks replacements', async () => {
    await writeFile(path, payload)
    await utimes(path, 1_700_000_000, 1_700_000_000)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    const before = await stat(path)
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

  it('rehashes Windows files even when corrupt bytes have the exact same fingerprint', async () => {
    vi.mocked(platform).mockReturnValue('win32')
    await writeFile(path, payload)
    const unchanged = await stat(path, { bigint: true })
    // Model an identical metadata observation independently of the host's clock
    // resolution. The hash still reads the real, subsequently corrupted bytes.
    vi.mocked(stat).mockResolvedValue(unchanged)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)

    await writeFile(path, Buffer.alloc(payload.length, 2))
    await utimes(path, unchanged.atime, unchanged.mtime)
    expect(await readVerifiedAssetSize(path, expected)).toBeNull()
    expect(createReadStream).toHaveBeenCalledTimes(3)
  })

  it('does not read or populate the metadata cache on Windows', async () => {
    await writeFile(path, payload)
    vi.mocked(platform).mockReturnValue('linux')
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    vi.mocked(platform).mockReturnValue('win32')
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(createReadStream).toHaveBeenCalledTimes(2)
    vi.mocked(platform).mockReturnValue('linux')
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(createReadStream).toHaveBeenCalledTimes(3)
  })

  it('rehashes a full-size Windows readiness payload and rejects corruption near EOF', async () => {
    vi.mocked(platform).mockReturnValue('win32')
    // Match the largest runtime + voice readiness set without downloading it.
    const fullPayload = Buffer.alloc(30_132_422, 0x5a)
    const fullExpected = {
      sizeBytes: fullPayload.length,
      sha256: createHash('sha256').update(fullPayload).digest('hex')
    }
    await writeFile(path, fullPayload)
    const unchanged = await stat(path, { bigint: true })
    vi.mocked(stat).mockResolvedValue(unchanged)
    const durationsMs: string[] = []
    const verify = async (): Promise<number | null> => {
      const start = performance.now()
      const result = await readVerifiedAssetSize(path, fullExpected)
      durationsMs.push((performance.now() - start).toFixed(2))
      return result
    }
    expect(await verify()).toBe(fullPayload.length)
    expect(await verify()).toBe(fullPayload.length)
    fullPayload[fullPayload.length - 1] ^= 0xff
    await writeFile(path, fullPayload)
    await utimes(path, unchanged.atime, unchanged.mtime)
    expect(await verify()).toBeNull()
    expect(createReadStream).toHaveBeenCalledTimes(3)
    // Diagnostic only: host-native timings under Windows policy, no speed gate.
    console.info(`sanoTTS SHA-256 host=${process.platform} bytes=${fullPayload.length} ms=${durationsMs.join(',')}`)
  })

  it.each(['linux', 'darwin', 'win32'] as const)('checks the expected digest and absolute path on %s', async (os) => {
    vi.mocked(platform).mockReturnValue(os)
    await writeFile(path, payload)
    expect(await readVerifiedAssetSize(path, expected)).toBe(payload.length)
    expect(await readVerifiedAssetSize(path, { ...expected, sha256: '0'.repeat(64) })).toBeNull()
    const otherPath = join(rootDir, 'other.bin')
    await writeFile(otherPath, Buffer.alloc(payload.length, 1))
    expect(await readVerifiedAssetSize(otherPath, expected)).toBeNull()
    expect(createReadStream).toHaveBeenCalledTimes(3)
  })

  it.each(['linux', 'darwin', 'win32'] as const)('rejects metadata changes while hashing matching bytes on %s', async (os) => {
    vi.mocked(platform).mockReturnValue(os)
    await writeFile(path, payload)
    const before = await stat(path, { bigint: true })
    const after = await stat(path, { bigint: true })
    after.ctimeNs += 1n
    // Exercise the before/after guard without depending on a real clock tick.
    vi.mocked(stat).mockResolvedValueOnce(before).mockResolvedValueOnce(after)
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
