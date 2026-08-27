import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_RENAME_RETRY_ATTEMPTS = 6
const DEFAULT_RENAME_RETRY_BASE_DELAY_MS = 25
const RETRYABLE_RENAME_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export type AtomicWriteOptions = {
  beforeCommit?: () => void
  renameRetry?: { attempts?: number; baseDelayMs?: number }
}

/** Write a replacement beside its target, flush it, then atomically publish it. */
export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  try {
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(temporaryPath, path, options)
    await syncDirectory(dirname(path))
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function renameWithRetry(from: string, to: string, options: AtomicWriteOptions): Promise<void> {
  const attempts = Math.max(1, Math.floor(options.renameRetry?.attempts ?? DEFAULT_RENAME_RETRY_ATTEMPTS))
  const baseDelayMs = Math.max(0, Math.floor(options.renameRetry?.baseDelayMs ?? DEFAULT_RENAME_RETRY_BASE_DELAY_MS))
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      options.beforeCommit?.()
      await rename(from, to)
      return
    } catch (error) {
      if (attempt >= attempts || !RETRYABLE_RENAME_ERROR_CODES.has(String((error as NodeJS.ErrnoException).code ?? ''))) throw error
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt))
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return
  try {
    await handle.sync()
  } catch {
    // Some filesystems do not permit directory fsync; file fsync has completed.
  } finally {
    await handle.close().catch(() => undefined)
  }
}
