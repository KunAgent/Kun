import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Recursively sums file sizes under `dir` (including subdirectories such as
 * `archives/` and `snapshots/`). Read-only; never throws — a missing
 * directory or an unreadable entry contributes 0 bytes.
 */
export async function computeDirectoryByteSize(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  let total = 0
  for (const entry of entries) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await computeDirectoryByteSize(entryPath)
    } else if (entry.isFile()) {
      const info = await stat(entryPath).catch(() => null)
      total += info?.size ?? 0
    }
  }
  return total
}
