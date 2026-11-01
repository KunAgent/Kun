import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Allocated bytes under a path, never following symlinks. POSIX uses `du -sk`
 * because worktrees hold node_modules trees with hundreds of thousands of
 * files; a JS walk there costs tens of seconds. Windows (and a failing `du`)
 * falls back to a bounded-concurrency walk of logical sizes.
 */
export async function pathBytes(path: string): Promise<number> {
  if (!(await lstat(path).catch(() => null))) return 0
  if (process.platform !== 'win32') {
    const viaDu = await duBytes(path).catch(() => null)
    if (viaDu !== null) return viaDu
  }
  return walkBytes(path)
}

function duBytes(path: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    execFile('du', ['-sk', path], { timeout: 120_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      // du exits non-zero when a nested entry vanished mid-scan; its total is still usable.
      const kib = Number.parseInt(String(stdout).trim().split(/\s+/)[0] ?? '', 10)
      if (Number.isFinite(kib)) resolve(kib * 1024)
      else if (error) reject(error)
      else resolve(null)
    })
  })
}

export async function walkBytes(root: string, concurrency = 16): Promise<number> {
  let total = 0
  const queue: string[] = [root]
  const worker = async (): Promise<void> => {
    for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
      const info = await lstat(path).catch(() => null)
      if (!info) continue
      if (info.isDirectory()) {
        const names = await readdir(path).catch(() => [] as string[])
        for (const name of names) queue.push(join(path, name))
      } else if (info.isFile()) {
        total += info.size
      }
    }
  }
  // Workers drain a shared queue; rerun until no directory expansion is left.
  while (queue.length > 0) await Promise.all(Array.from({ length: concurrency }, worker))
  return total
}

/** True when a directory holds no regular files at any depth (ignoring Finder litter). */
export async function directoryHasNoFiles(root: string): Promise<boolean> {
  const names = await readdir(root).catch(() => null)
  if (!names) return false
  for (const name of names) {
    if (name === '.DS_Store') continue
    const path = join(root, name)
    const info = await lstat(path).catch(() => null)
    if (!info) continue
    if (!info.isDirectory()) return false
    if (!(await directoryHasNoFiles(path))) return false
  }
  return true
}
