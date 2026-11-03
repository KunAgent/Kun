import { setTimeout as delay } from 'node:timers/promises'
import { readFile, stat } from 'node:fs/promises'
import { toNamespacedPath } from 'node:path'
import { windowsStartupNative } from '../process/windows-startup-native.js'
import { classifyStartLock, lockErrno, ManagerStartLockError, type StartLockDiagnostic } from './manager-start-lock-diagnostics.js'
import { runWithStartLock } from './manager-start-lock-support.js'

export async function withWindowsManagerStartLock<T>(input: {
  path: string
  owner: string
  action: () => Promise<T>
  signal?: AbortSignal
  deadline: number
  diagnostic: StartLockDiagnostic
  check: () => void
  fail: (reason: 'timeout' | 'unverifiable' | 'io', error?: unknown) => never
  onWait?: (diagnostic: StartLockDiagnostic) => void
}): Promise<T> {
  const native = windowsStartupNative()
  const start = performance.now()
  let nextInspection = 0
  for (;;) {
    input.check()
    input.diagnostic.phase = 'acquire'
    const lock = await native.acquireStartLock(toNamespacedPath(input.path)).catch((error) => input.fail('io', error))
    if (!lock) {
      if (performance.now() >= nextInspection) {
        nextInspection = performance.now() + 1_000
        try {
          const details = await stat(input.path)
          const observed = details.isFile() && details.size <= 65536
            ? classifyStartLock(await readFile(input.path, 'utf8')) : { state: 'invalid' as const, pid: undefined }
          input.diagnostic.ownerState = observed.state
          input.diagnostic.ownerPid = observed.pid
          if (observed.state === 'unknown') input.fail('unverifiable')
        } catch (error) {
          if (error instanceof ManagerStartLockError) throw error
          if (lockErrno(error) !== 'ENOENT') input.fail('io', error)
        }
      }
      input.diagnostic.waitedMs = Math.round(performance.now() - start)
      input.onWait?.({ ...input.diagnostic })
      input.check()
      await delay(Math.min(100, Math.max(1, input.deadline - performance.now())), undefined, { signal: input.signal })
      continue
    }
    let written = false
    return runWithStartLock(async () => {
      input.check()
      input.diagnostic.phase = 'inspect'
      if (!lock.created) {
        const observed = classifyStartLock(lock.text)
        input.diagnostic.ownerState = observed.state
        input.diagnostic.ownerPid = observed.pid
        if (observed.state === 'alive' || observed.state === 'unknown') input.fail('unverifiable')
        // Opening the old protocol file without share-write/delete proves no
        // old client still holds its wx handle. Corrupt JSON alone is not proof;
        // the kernel lock and legacy handle together authorize metadata reuse.
        // Profile claims and participant checks still fence the business writer.
      }
      input.check()
      input.diagnostic.phase = 'write'
      await native.writeStartLock(lock.handle, input.owner).catch((error) => input.fail('io', error))
      written = true
      input.check()
      return input.action()
    }, async () => {
      input.diagnostic.phase = 'release'
      await native.releaseStartLock(lock.handle, written || lock.created).catch((error) => {
        if (error instanceof ManagerStartLockError) throw error
        input.fail('io', error)
      })
    })
  }
}
