import { windowsStartupNative, type WindowsStartupLock, type WindowsStartupNative } from '../process/windows-startup-native.js'
import { ManagerStartLockError, lockErrorCode, runWithStartLock, waitForStartLock } from './manager-start-lock-support.js'

type Owner = { pid: number; processIdentity?: string; acquiredAt?: string }
function readOwner(text: string): Owner | undefined {
  try {
    const value = JSON.parse(text) as Owner | null
    return value && Number.isSafeInteger(value.pid) && value.pid > 0 ? value : undefined
  } catch { return undefined }
}

function canRecover(lock: WindowsStartupLock, native: WindowsStartupNative, path: string, start: number): boolean {
  if (lock.created) return true
  const owner = readOwner(lock.text)
  // Unlike a timestamp, the pinned Windows handle proves there is no writable
  // legacy wx handle. Old and new clients keep that handle for their entire
  // critical section. Denied delete sharing also fences delayed legacy unlink.
  if (!owner) return true
  const current = native.inspectProcess(owner.pid)
  if (current.state === 'dead') return true
  if (current.state === 'unknown' || !current.identity) {
    throw new ManagerStartLockError(path, 'unverifiable', performance.now() - start, owner.pid)
  }
  if (typeof owner.processIdentity === 'string') return current.identity !== owner.processIdentity
  // A legacy owner has no birth identity, but a later process cannot have
  // created its record. Missing/invalid dates must never authorize takeover.
  const acquiredAt = Date.parse(owner.acquiredAt ?? '')
  return Number.isFinite(acquiredAt) && current.startedAtMs !== undefined && current.startedAtMs > acquiredAt
}

export async function withWindowsManagerStartLock<T>(
  path: string, owner: string, action: () => Promise<T>, start: number, deadline: number, signal?: AbortSignal
): Promise<T> {
  const native = windowsStartupNative()
  let lastPid: number | undefined
  while (performance.now() < deadline) {
    signal?.throwIfAborted()
    let lock: WindowsStartupLock | undefined
    try { lock = native.acquire(`${path}.guard`, path) } catch (error) {
      throw new ManagerStartLockError(path, 'io', performance.now() - start, undefined, lockErrorCode(error))
    }
    if (lock) {
      let admitted = false
      try {
        lastPid = readOwner(lock.text)?.pid
        if (canRecover(lock, native, path, start)) {
          signal?.throwIfAborted()
          if (performance.now() >= deadline) throw new ManagerStartLockError(path, 'busy', performance.now() - start, lastPid)
          native.publish(lock.handle, owner)
          admitted = true
        }
      } finally {
        if (!admitted) native.release(lock.handle)
      }
      if (admitted) return runWithStartLock(async () => {
        signal?.throwIfAborted()
        if (performance.now() >= deadline) throw new ManagerStartLockError(path, 'busy', performance.now() - start, lastPid)
        return action()
      }, () => native.release(lock!.handle))
    }
    await waitForStartLock(deadline, signal)
  }
  signal?.throwIfAborted()
  throw new ManagerStartLockError(path, 'busy', performance.now() - start, lastPid)
}
