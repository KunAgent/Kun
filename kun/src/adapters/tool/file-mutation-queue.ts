import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const fileMutationQueues = new Map<string, Promise<void>>()
let registrationQueue = Promise.resolve()
const DEFAULT_FILE_MUTATION_LOCK_ROOT = join(tmpdir(), 'kun-file-mutation-locks')
const LOCK_OWNER_FILE = 'owner.json'
const LOCK_POLL_MS = 25
const LOCK_WAIT_TIMEOUT_MS = 60_000
const OWNERLESS_LOCK_STALE_MS = 10 * 60_000

export type FileMutationQueueOptions = {
  /**
   * Directory holding the lock entries. Callers that must agree with other
   * processes independently of their environment pass a root derived from the
   * target file ({@link fileMutationLockRoot}); the default root lives under
   * the process' temporary directory and therefore follows `TMPDIR`.
   */
  lockRoot?: string
}

/**
 * Physical identity of a file: symlinks resolved, and for a file that does not
 * exist yet the real directory plus the basename. Two callers that reach the
 * same file through different paths (a symlinked directory, a relative path)
 * must land on the same string or they will not share a lock.
 */
export function physicalFilePath(filePath: string): string {
  const resolved = resolve(filePath)
  const existing = safeRealpath(resolved)
  if (existing) return existing
  const parent = safeRealpath(dirname(resolved))
  return parent ? join(parent, basename(resolved)) : resolved
}

function safeRealpath(path: string): string | null {
  try {
    // Use the same resolution as `fs/promises.realpath`: the lock key has to
    // match the key other call sites and tests derive for the same file.
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Lock root for a file that is shared by every process on this host.
 *
 * A temporary-directory root cannot be used for that: two runtime processes
 * with different `TMPDIR` would each lock a private directory and neither would
 * see the other. A root next to the file itself is derived from the file's
 * physical path, so every process reaching the same file agrees, and the lock
 * lifetime is tied to the data the lock protects.
 */
export function fileMutationLockRoot(filePath: string): string {
  return join(dirname(physicalFilePath(filePath)), '.kun-file-locks')
}

type LockOwner = {
  pid: number
  createdAtMs: number
  key: string
}

function isExistingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EPERM'
    )
  }
}

function lockPathForKey(key: string, lockRoot: string): string {
  const hash = createHash('sha256').update(key).digest('hex')
  return join(lockRoot, `${hash}.lock`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const raw = await readFile(join(lockPath, LOCK_OWNER_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LockOwner>
    if (
      typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAtMs === 'number' &&
      typeof parsed.key === 'string'
    ) {
      return {
        pid: parsed.pid,
        createdAtMs: parsed.createdAtMs,
        key: parsed.key
      }
    }
  } catch {
    // Missing or malformed owner metadata is handled by mtime-based staleness below.
  }
  return null
}

async function removeDeadOrStaleLock(lockPath: string, nowMs: number): Promise<boolean> {
  const owner = await readLockOwner(lockPath)
  if (owner && !isProcessAlive(owner.pid)) {
    await rm(lockPath, { recursive: true, force: true })
    return true
  }
  if (owner) return false

  const info = await stat(lockPath).catch(() => null)
  if (!info) return true
  if (nowMs - info.mtimeMs < OWNERLESS_LOCK_STALE_MS) return false
  await rm(lockPath, { recursive: true, force: true })
  return true
}

async function acquireFileMutationLock(key: string, lockRoot: string): Promise<() => Promise<void>> {
  await mkdir(lockRoot, { recursive: true })
  const lockPath = lockPathForKey(key, lockRoot)
  const startedAt = Date.now()
  for (;;) {
    try {
      await mkdir(lockPath)
    } catch (error) {
      if (!isExistingPathError(error)) throw error
      const nowMs = Date.now()
      if (await removeDeadOrStaleLock(lockPath, nowMs)) continue
      if (nowMs - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for file mutation lock: ${key}`)
      }
      await delay(LOCK_POLL_MS)
      continue
    }

    try {
      await writeFile(
        join(lockPath, LOCK_OWNER_FILE),
        JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), key } satisfies LockOwner),
        'utf8'
      )
      return async () => {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (error) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}

function getMutationQueueKey(filePath: string): string {
  // One identity for the in-process queue, the on-disk lock and the Manager
  // resource: the physical file, not the path string a caller happened to use.
  return physicalFilePath(filePath)
}

export async function withFileMutationQueue<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: FileMutationQueueOptions = {}
): Promise<T> {
  const lockRoot = options.lockRoot ?? DEFAULT_FILE_MUTATION_LOCK_ROOT
  if (!lockRoot) throw new Error('file mutation lock root must not be empty')
  const registration = registrationQueue.then(async () => {
    const key = getMutationQueueKey(filePath)
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve()

    let releaseNext!: () => void
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue
    })
    const chainedQueue = currentQueue.then(() => nextQueue)
    fileMutationQueues.set(key, chainedQueue)

    return { key, currentQueue, chainedQueue, releaseNext }
  })

  registrationQueue = registration.then(
    () => undefined,
    () => undefined
  )

  const { key, currentQueue, chainedQueue, releaseNext } = await registration
  await currentQueue
  let releaseLock: (() => Promise<void>) | undefined
  try {
    releaseLock = await acquireFileMutationLock(key, lockRoot)
    return await fn()
  } finally {
    try {
      await releaseLock?.()
    } finally {
      releaseNext()
      if (fileMutationQueues.get(key) === chainedQueue) {
        fileMutationQueues.delete(key)
      }
    }
  }
}
