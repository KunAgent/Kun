import { createHash } from 'node:crypto'
import { lstat, open, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { MigrationLogger } from './legacy-data-migration'
import {
  canonicalRelativePath,
  inventoriesEqual,
  treeFingerprintRecord
} from './runtime-data-dir-migration-inventory'
import type { PreservedHistoryCheck } from './runtime-data-dir-migration-types'

async function hashFile(path: string, buffer: Buffer, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const file = await open(path, 'r')
  try {
    while (true) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) return hash.digest('hex')
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await file.close()
  }
}

/** Read-only post-activation audit. Yield on filesystem I/O, including inside large files. */
export async function auditPreservedHistory(
  check: PreservedHistoryCheck,
  log: MigrationLogger,
  signal: AbortSignal
): Promise<void> {
  const inventory = { files: 0, directories: 0, symlinks: 0, bytes: 0 }
  const digest = check.fingerprint
    ? { hash: createHash('sha256'), buffer: Buffer.allocUnsafe(1024 * 1024) } : undefined
  async function visit(path: string): Promise<void> {
    signal.throwIfAborted()
    const stat = await lstat(path)
    if (path === check.path && !stat.isDirectory()) throw new Error('Preserved history root is no longer a directory')
    const relativePath = canonicalRelativePath(check.path, path)
    if (stat.isDirectory()) {
      inventory.directories++
      const names = await readdir(path)
      if (digest) {
        digest.hash.update(treeFingerprintRecord(relativePath, stat))
        names.sort()
      }
      for (const name of names) await visit(join(path, name))
    } else if (stat.isSymbolicLink()) {
      inventory.symlinks++
      inventory.bytes += stat.size
      if (digest) digest.hash.update(treeFingerprintRecord(relativePath, stat, await readlink(path)))
    } else {
      inventory.files++
      inventory.bytes += stat.size
      if (digest) {
        if (!stat.isFile()) throw new Error(`Runtime tree contains an unsupported entry: ${path}`)
        const fileHash = await hashFile(path, digest.buffer, signal)
        digest.hash.update(treeFingerprintRecord(relativePath, stat, fileHash))
      }
    }
  }
  await visit(check.path)
  signal.throwIfAborted()
  if (digest) {
    const currentFingerprint = digest.hash.digest('hex')
    if (currentFingerprint !== check.fingerprint) {
      log('legacy-migration: preserved Runtime history fingerprint changed', {
        preservedPath: check.path, recordedFingerprint: check.fingerprint, currentFingerprint,
        verification: 'full-fingerprint'
      })
    }
  } else if (!inventoriesEqual(inventory, check.inventory)) {
    log('legacy-migration: preserved Runtime history inventory changed', {
      preservedPath: check.path, recordedInventory: check.inventory, currentInventory: inventory,
      verification: 'inventory'
    })
  }
}
