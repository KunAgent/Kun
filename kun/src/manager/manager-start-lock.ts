import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { requireRuntimeProcessIdentity } from '../server/runtime-process-identity.js'
import { classifyStartLock, lockErrno, ManagerStartLockError, type StartLockDiagnostic, type StartLockScope } from './manager-start-lock-diagnostics.js'
import { runWithStartLock } from './manager-start-lock-support.js'

export { ManagerStartLockError } from './manager-start-lock-diagnostics.js'

// Activation requires the Windows native, installed and mixed-version gates.
const WINDOWS_NATIVE_LOCK_PROTOCOL_ENABLED = false

export type ManagerStartLockOptions = {
  timeoutMs?: number
  /** Monotonic deadline shared by every election in one launch attempt. */
  deadline?: number
  attemptId?: string
  scope?: StartLockScope
  onWait?: (diagnostic: StartLockDiagnostic) => void
}

export async function withManagerStartLock<T>(
  controlDir: string, action: () => Promise<T>, signal?: AbortSignal, options: ManagerStartLockOptions = {}
): Promise<T> {
  const start = performance.now()
  const deadline = Math.min(options.deadline ?? Infinity, start + (options.timeoutMs ?? 40_000))
  const path = join(controlDir, '.manager-start.lock')
  const diagnostic: StartLockDiagnostic = {
    path, scope: options.scope ?? 'manager', phase: 'acquire', waitedMs: 0, attemptId: options.attemptId ?? randomUUID()
  }
  const fail = (reason: 'timeout' | 'unverifiable' | 'io', error?: unknown) => {
    throw new ManagerStartLockError(reason, { ...diagnostic, waitedMs: Math.round(performance.now() - start),
      ...(lockErrno(error) ? { errno: lockErrno(error) } : {}) })
  }
  const check = () => {
    signal?.throwIfAborted()
    if (performance.now() >= deadline) fail('timeout')
  }
  check()
  try { await mkdir(controlDir, { recursive: true, mode: 0o700 }) } catch (error) { fail('io', error) }
  check()
  const owner = JSON.stringify({
    pid: process.pid, processIdentity: requireRuntimeProcessIdentity(), instanceId: randomUUID(),
    generation: 1, acquiredAt: new Date().toISOString()
  })
  // Windows uses a process-held native handle only after its mixed-protocol
  // validation gate has succeeded for the bundled helper.
  if (process.platform === 'win32' && WINDOWS_NATIVE_LOCK_PROTOCOL_ENABLED) {
    const { withWindowsManagerStartLock } = await import('./manager-start-lock-windows-async.js')
    return withWindowsManagerStartLock({ path, owner, action, signal, deadline, diagnostic, check, fail, onWait: options.onWait })
  }
  let nextInspection = 0
  let lastText: string | undefined
  while (true) {
    check()
    diagnostic.phase = 'acquire'
    let handle: Awaited<ReturnType<typeof open>> | undefined
    // Only acquisition errors are lock contention. Never replay the action,
    // including when it or cleanup raises EEXIST.
    try { handle = await open(path, 'wx', 0o600) } catch (error) {
      if (lockErrno(error) !== 'EEXIST') fail('io', error)
    }
    if (handle) {
      let written = false
      return runWithStartLock(async () => {
        check()
        diagnostic.phase = 'write'
        try { await handle.writeFile(owner, 'utf8'); written = true } catch (error) { fail('io', error) }
        check()
        return action()
      }, async () => {
        diagnostic.phase = 'release'
        await handle.close()
        try {
          if (written && await readFile(path, 'utf8') === owner) await rm(path)
        } catch (error) { if (lockErrno(error) !== 'ENOENT') fail('io', error) }
      })
    }
    diagnostic.phase = 'inspect'
    try {
      const details = await stat(path)
      if (!details.isFile() || details.size > 64 * 1024) {
        diagnostic.ownerState = 'invalid'
        fail('unverifiable')
      }
      const text = await readFile(path, 'utf8')
      if (text !== lastText || performance.now() >= nextInspection) {
        const observed = classifyStartLock(text)
        diagnostic.ownerState = observed.state
        diagnostic.ownerPid = observed.pid
        nextInspection = performance.now() + 1_000
        lastText = text
      }
      if (diagnostic.ownerState === 'dead' || diagnostic.ownerState === 'reused') {
        // POSIX retains the existing protocol. Windows reclamation never uses
        // read/compare/unlink; its legacy coordination is in the native backend.
        if (await readFile(path, 'utf8') === text) await rm(path)
        continue
      }
      if (diagnostic.ownerState === 'unknown') fail('unverifiable')
      if (['empty', 'malformed', 'invalid'].includes(diagnostic.ownerState ?? '') &&
        performance.now() - start >= 1_000) fail('unverifiable')
    } catch (error) {
      if (error instanceof ManagerStartLockError) throw error
      if (lockErrno(error) === 'ENOENT') continue
      fail('io', error)
    }
    diagnostic.waitedMs = Math.round(performance.now() - start)
    options.onWait?.({ ...diagnostic })
    check()
    await delay(Math.min(100, Math.max(1, deadline - performance.now())), undefined, { signal })
  }
}
