import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type AtomicWriteFileOptions = {
  allowDirectWriteFallback?: boolean
  /** Sync the temporary file and parent directory around the atomic rename. */
  durable?: boolean
  /** Synchronous guard run immediately before each irreversible commit attempt. */
  beforeCommit?: () => void
  signal?: AbortSignal
  renameRetry?: {
    attempts?: number
    baseDelayMs?: number
  }
}

const DEFAULT_RENAME_RETRY_ATTEMPTS = 6
const DEFAULT_RENAME_RETRY_BASE_DELAY_MS = 25
const RETRYABLE_RENAME_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export async function atomicWriteFile(
  path: string,
  contents: string,
  options: AtomicWriteFileOptions = {}
): Promise<void> {
  options.signal?.throwIfAborted()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    if (options.durable) {
      const handle = await open(tmp, 'w', 0o600)
      try {
        options.signal?.throwIfAborted()
        await handle.writeFile(contents, { encoding: 'utf8', signal: options.signal })
        await handle.sync()
      } finally {
        await handle.close()
      }
    } else {
      await writeFile(tmp, contents, { encoding: 'utf-8', mode: 0o600, signal: options.signal })
    }
    try {
      await renameFileWithRetry(tmp, path, options.renameRetry, options.beforeCommit, options.signal)
    } catch (error) {
      if (options.allowDirectWriteFallback === false || !shouldFallbackToDirectWrite(error)) {
        throw error
      }
      options.signal?.throwIfAborted()
      options.beforeCommit?.()
      await writeFile(path, contents, { encoding: 'utf-8', mode: 0o600, signal: options.signal })
    }
    if (options.durable) await syncDirectory(dirname(path))
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw describeAtomicWriteError(path, error)
  }
  await rm(tmp, { force: true }).catch(() => undefined)
}

async function syncDirectory(path: string): Promise<void> {
  // Directory handles cannot be opened on Windows. The file itself was still
  // synced before rename, so retain the strongest portable boundary there.
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Preserves Node fs error fields (`code`, `errno`, `syscall`, `path`) while
 * prefixing a stable `atomic write failed (CODE) for <path>` message so
 * manager/runtime logs clearly attribute disk exhaustion (ENOSPC) or
 * permission failures to the exact lease/config file instead of a bare
 * "Internal server error" / "fetch failed".
 */
function describeAtomicWriteError(path: string, error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const source = error as NodeJS.ErrnoException
  const code = String(source.code ?? '')
  const prefixed = new Error(
    `atomic write failed${code ? ` (${code})` : ''} for ${path}: ${error.message}`,
    { cause: error }
  )
  Object.assign(prefixed, {
    ...(source.code !== undefined ? { code: source.code } : {}),
    ...(source.errno !== undefined ? { errno: source.errno } : {}),
    ...(source.syscall !== undefined ? { syscall: source.syscall } : {}),
    ...(source.path !== undefined ? { path: source.path } : {})
  })
  return prefixed
}

export async function renameFileWithRetry(
  from: string,
  to: string,
  options?: NonNullable<AtomicWriteFileOptions['renameRetry']>,
  beforeCommit?: () => void,
  signal?: AbortSignal
): Promise<void> {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? DEFAULT_RENAME_RETRY_ATTEMPTS))
  const baseDelayMs = Math.max(0, Math.floor(options?.baseDelayMs ?? DEFAULT_RENAME_RETRY_BASE_DELAY_MS))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      signal?.throwIfAborted()
      beforeCommit?.()
      await rename(from, to)
      return
    } catch (error) {
      if (attempt >= attempts || !isRetryableRenameError(error)) {
        throw error
      }
      await delay(baseDelayMs * attempt, signal)
    }
  }
}

function isRetryableRenameError(error: unknown): boolean {
  return RETRYABLE_RENAME_ERROR_CODES.has(String((error as { code?: unknown })?.code ?? ''))
}

function shouldFallbackToDirectWrite(error: unknown): boolean {
  return process.platform === 'win32' && isRetryableRenameError(error)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}
