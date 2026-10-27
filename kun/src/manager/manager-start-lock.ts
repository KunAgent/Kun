import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { requireRuntimeProcessIdentity, runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import { withWindowsManagerStartLock } from './manager-start-lock-windows.js'
import { ManagerStartLockError, MANAGER_START_LOCK_TIMEOUT_MS, lockErrorCode, runWithStartLock, waitForStartLock } from './manager-start-lock-support.js'
export { ManagerStartLockError } from './manager-start-lock-support.js'

// Mixed-version protocol activation requires Windows native/installer evidence.
// Keep production on the shared legacy namespace until that release gate passes.
const WINDOWS_NATIVE_LOCK_PROTOCOL_ENABLED = false

export async function withManagerStartLock<T>(controlDir: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const start = performance.now()
  const deadline = start + MANAGER_START_LOCK_TIMEOUT_MS
  const path = join(controlDir, '.manager-start.lock')
  try { await mkdir(controlDir, { recursive: true, mode: 0o700 }) } catch (error) {
    throw new ManagerStartLockError(path, 'io', performance.now() - start, undefined, lockErrorCode(error))
  }
  const owner = JSON.stringify({ pid: process.pid, instanceId: randomUUID(), acquiredAt: new Date().toISOString(),
    processIdentity: requireRuntimeProcessIdentity() })
  if (process.platform === 'win32' && WINDOWS_NATIVE_LOCK_PROTOCOL_ENABLED) {
    return withWindowsManagerStartLock(path, owner, action, start, deadline, signal)
  }
  while (performance.now() < deadline) {
    signal?.throwIfAborted()
    let handle: FileHandle
    try { handle = await open(path, 'wx', 0o600) } catch (error) {
      if (lockErrorCode(error) !== 'EEXIST') {
        throw new ManagerStartLockError(path, 'io', performance.now() - start, undefined, lockErrorCode(error))
      }
      await reclaimExitedOwner(path, start)
      await waitForStartLock(deadline, signal)
      continue
    }
    // Only open(wx) errors mean contention. Never retry an EEXIST from action.
    return runWithStartLock(async () => {
      await handle.writeFile(owner, 'utf8')
      signal?.throwIfAborted()
      if (performance.now() >= deadline) throw new ManagerStartLockError(path, 'busy', performance.now() - start)
      return action()
    }, async () => {
      await handle.close()
      await removeOwnedLock(path, owner)
    })
  }
  signal?.throwIfAborted()
  throw new ManagerStartLockError(path, 'busy', performance.now() - start)
}

async function reclaimExitedOwner(path: string, start: number): Promise<void> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) {
    if (lockErrorCode(error) === 'ENOENT') return
    throw new ManagerStartLockError(path, 'io', performance.now() - start, undefined, lockErrorCode(error))
  }
  let owner: { pid?: number; processIdentity?: string; acquiredAt?: string }
  try { owner = JSON.parse(text) } catch {
    // POSIX has no pinned Windows sharing handle. A timestamp alone does not
    // prove a paused writer has exited; do not silently delete an unknown lock.
    // An empty file may be the short open/write publication window: wait.
    if (text === '') return
    throw new ManagerStartLockError(path, 'corrupt', performance.now() - start)
  }
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0) {
    throw new ManagerStartLockError(path, 'corrupt', performance.now() - start)
  }
  const record = typeof owner.acquiredAt === 'string' ? {
    startedAt: owner.acquiredAt,
    ...(typeof owner.processIdentity === 'string' ? { processIdentity: owner.processIdentity } : {})
  } : undefined
  if (!runtimeProcessIsAlive(owner.pid!, record)) await removeOwnedLock(path, text)
}

async function removeOwnedLock(path: string, owner: string): Promise<void> {
  try { if (await readFile(path, 'utf8') === owner) await rm(path, { force: true }) } catch (error) {
    if (lockErrorCode(error) !== 'ENOENT') throw error
  }
}
