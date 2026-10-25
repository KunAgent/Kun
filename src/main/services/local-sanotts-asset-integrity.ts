import { createHash } from 'node:crypto'
import { createReadStream, type BigIntStats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { platform } from 'node:os'
import { resolve } from 'node:path'

export type SanottsAssetIntegrity = { sizeBytes: number; sha256: string }

// Speech readiness is checked for every chunk. On POSIX, reuse successful hashes
// while the full fingerprint matches. Windows metadata may not distinguish a
// same-length rewrite with restored mtime, so always hash there. Bound the cache
// across profile changes.
const verifiedAssets = new Map<string, string>()
const MAX_VERIFIED_ASSETS = 256

function fingerprint(path: string, info: BigIntStats, expected: SanottsAssetIntegrity): string {
  return [path, info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs,
    expected.sizeBytes, expected.sha256].join(':')
}

export async function fileSha256(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { signal })) {
    signal?.throwIfAborted()
    hash.update(chunk)
  }
  signal?.throwIfAborted()
  return hash.digest('hex')
}

/** Exact on-disk byte size and SHA-256, or null for missing/corrupt assets. */
export async function readVerifiedAssetSize(
  path: string,
  expected: SanottsAssetIntegrity,
  signal?: AbortSignal
): Promise<number | null> {
  signal?.throwIfAborted()
  const absolutePath = resolve(path)
  const useMetadataCache = platform() !== 'win32'
  try {
    const before = await stat(absolutePath, { bigint: true })
    signal?.throwIfAborted()
    if (!before.isFile() || before.size !== BigInt(expected.sizeBytes)) {
      verifiedAssets.delete(absolutePath)
      return null
    }
    const key = fingerprint(absolutePath, before, expected)
    if (useMetadataCache && verifiedAssets.get(absolutePath) === key) return expected.sizeBytes
    verifiedAssets.delete(absolutePath)
    const digest = await fileSha256(absolutePath, signal)
    const after = await stat(absolutePath, { bigint: true })
    signal?.throwIfAborted()
    // Reject a digest mismatch or an observed fingerprint change while hashing.
    if (digest !== expected.sha256 || fingerprint(absolutePath, after, expected) !== key) return null
    if (useMetadataCache) {
      if (verifiedAssets.size >= MAX_VERIFIED_ASSETS) {
        const oldestPath = verifiedAssets.keys().next().value
        if (oldestPath !== undefined) verifiedAssets.delete(oldestPath)
      }
      verifiedAssets.set(absolutePath, key)
    }
    return expected.sizeBytes
  } catch (error) {
    verifiedAssets.delete(absolutePath)
    if (signal?.aborted) signal.throwIfAborted()
    if (error instanceof Error && error.name === 'AbortError') throw error
    return null
  }
}
