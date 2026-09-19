import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, resolve } from 'node:path'
import type { Writable } from 'node:stream'
import { OWNED_PROCESS_GUARD_SOURCE } from './owned-process-guard.js'
import {
  beginWindowsOwnedProcessShutdown,
  shutdownWindowsOwnedProcesses,
  resumeWindowsOwnedProcessAdmission,
  spawnWindowsOwnedProcess,
  stopWindowsOwnedProcess
} from './owned-process-windows.js'

export type OwnedProcessStopOptions = { graceMs?: number; timeoutMs?: number }
export type OwnedProcessShutdownOptions = OwnedProcessStopOptions & { exclude?: readonly ChildProcess[] }
export type SpawnOwnedProcessOptions = SpawnOptions & { ownerLossGraceMs?: number; trackDescendants?: boolean }
type Guard = {
  child: ChildProcess
  scopeOwnerPid?: number
  scopeOwnerBirth?: string
  request(message: Record<string, unknown>): Promise<void>
}
const owned = new Map<ChildProcess, Guard>()
let guardPromise: Promise<Guard> | undefined
let activeGuard: Guard | undefined
let guardStarting = false
let guardStartFailed = false
let stopping = false
const retired = new WeakSet<ChildProcess>()
const windowsOwned = new WeakSet<ChildProcess>()

function startGuard(): Promise<Guard> {
  return new Promise((resolveGuard, rejectGuard) => {
    const child = spawn(process.execPath, ['-e', OWNED_PROCESS_GUARD_SOURCE], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ELECTRON_RUN_AS_NODE: '1', LC_ALL: 'C',
        KUN_PROCESS_STACK_OWNER_PID: process.env.KUN_PROCESS_STACK_OWNER_PID,
        KUN_PROCESS_STACK_OWNER_BIRTH: process.env.KUN_PROCESS_STACK_OWNER_BIRTH
      },
      windowsHide: true,
      detached: true
    })
    let nextId = 0
    const pending = new Map<number, { resolve(): void; reject(error: Error): void }>()
    const readyTimer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectGuard(new Error('Owned process guard did not become ready'))
    }, 5000)
    const guard: Guard = {
      child,
      request: (message) => new Promise<void>((accept, reject) => {
        if (!child.connected) { reject(new Error('Owned process guard is unavailable')); return }
        const id = ++nextId
        pending.set(id, { resolve: accept, reject })
        child.channel?.ref()
        child.send({ ...message, id }, (error) => {
          if (!error) return
          pending.delete(id)
          if (!pending.size) child.channel?.unref()
          reject(error)
        })
      })
    }
    child.on('message', (value: unknown) => {
      const message = value as {
        ready?: boolean; gone?: number; id?: number; error?: string
        scopeOwnerPid?: number; scopeOwnerBirth?: string
      }
      if (message.ready) {
        clearTimeout(readyTimer)
        child.unref()
        child.channel?.unref()
        guard.scopeOwnerPid = message.scopeOwnerPid
        guard.scopeOwnerBirth = message.scopeOwnerBirth
        activeGuard = guard
        resolveGuard(guard)
        return
      }
      if (message.gone !== undefined) {
        for (const target of owned.keys()) {
          if (target.pid !== message.gone) continue
          retired.add(target)
          owned.delete(target)
        }
        return
      }
      if (message.id === undefined) return
      const callback = pending.get(message.id)
      pending.delete(message.id)
      if (!pending.size) child.channel?.unref()
      if (message.error) callback?.reject(new Error(message.error))
      else callback?.resolve()
    })
    const fail = (error: Error) => {
      clearTimeout(readyTimer)
      rejectGuard(error)
      for (const entry of pending.values()) entry.reject(error)
      pending.clear()
    }
    child.once('error', fail)
    child.once('exit', () => fail(new Error('Owned process guard exited')))
  })
}

function guardChildDead(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null || !child.connected
}

function groupGone(pid: number): boolean {
  try { process.kill(-pid, 0); return false }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}

function getGuard(): Promise<Guard> {
  if (stopping) return Promise.reject(new Error('Owned process admission is closed'))
  // A guard that died (owner-loss kill, crash, dropped channel) must not
  // brick every future launch in this generation: start a fresh guard for
  // new registrations. Groups the dead guard supervised stay orphaned only
  // until their own exit or the next real owner loss.
  if (guardStartFailed || (activeGuard !== undefined && guardChildDead(activeGuard.child))) {
    guardStartFailed = false
    activeGuard = undefined
    guardPromise = undefined
  }
  if (!guardPromise) {
    guardStarting = true
    guardPromise = startGuard()
      .catch((error) => { guardStartFailed = true; throw error })
      .finally(() => { guardStarting = false })
  }
  return guardPromise
}

async function resolveCommand(command: string, options: SpawnOptions): Promise<string> {
  const cwd = options.cwd ? String(options.cwd) : process.cwd()
  const paths = command.includes('/')
    ? [isAbsolute(command) ? command : resolve(cwd, command)]
    : (options.env?.PATH ?? process.env.PATH ?? '').split(delimiter).map((entry) => resolve(cwd, entry, command))
  for (const candidate of paths) {
    try { await access(candidate, constants.X_OK); return candidate } catch { /* next PATH entry */ }
  }
  throw Object.assign(new Error(`Could not start executable: ${command}`), { code: 'ENOENT', syscall: 'spawn' })
}

function withLaunchPipe(stdio: StdioOptions | undefined): Exclude<StdioOptions, string> {
  const result: Exclude<StdioOptions, string> = Array.isArray(stdio)
    ? [...stdio]
    : [stdio ?? 'pipe', stdio ?? 'pipe', stdio ?? 'pipe']
  while (result.length < 3) result.push('pipe')
  result.push('pipe')
  return result
}

/**
 * Create a process in a registered group before allowing any user code to run.
 * The extra gate descriptor follows existing descriptors, preserving Node IPC.
 * POSIX process groups contain cooperative adapters, not arbitrary setsid code.
 */
export async function spawnOwnedProcess(
  command: string,
  args: readonly string[] = [],
  options: SpawnOwnedProcessOptions = {}
): Promise<ChildProcess> {
  if (stopping) throw new Error('Owned process admission is closed')
  if (process.platform === 'win32') {
    const child = await spawnWindowsOwnedProcess(command, args, options)
    windowsOwned.add(child)
    if (stopping) {
      await stopWindowsOwnedProcess(child, { graceMs: 0 })
      throw new Error('Owned process admission closed during launch')
    }
    return child
  }
  if (options.shell) throw new Error('Owned commands must select an explicit shell executable')
  const executable = await resolveCommand(command, options)
  const guard = await getGuard()
  if (stopping) throw new Error('Owned process admission is closed')
  const stdio = withLaunchPipe(options.stdio)
  const gateFd = stdio.length - 1
  const { ownerLossGraceMs = 20_000, trackDescendants = true, ...spawnOptions } = options
  const wrapper = `IFS= read -r kun_start <&${gateFd} || exit 125; [ "$kun_start" = start ] || exit 125; exec ${gateFd}<&-; exec "$@"`
  const child = spawn('/bin/sh', ['-c', wrapper, 'kun-owned', executable, ...args], {
    ...spawnOptions,
    env: {
      ...(spawnOptions.env ?? process.env),
      KUN_PROCESS_STACK_OWNER_PID: String(guard.scopeOwnerPid),
      KUN_PROCESS_STACK_OWNER_BIRTH: guard.scopeOwnerBirth
    },
    detached: true,
    stdio
  })
  owned.set(child, guard)
  const gate = child.stdio[gateFd] as Writable | null
  gate?.on('error', () => undefined)
  try {
    await new Promise<void>((accept, reject) => {
      child.once('spawn', accept)
      child.once('error', reject)
    })
    await guard.request({ type: 'register', pid: child.pid, ownerLossGraceMs, trackDescendants })
    if (stopping) throw new Error('Owned process admission closed during launch')
    gate?.end('start\n')
    return child
  } catch (error) {
    gate?.destroy()
    await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 3000 }).catch(() => undefined)
    throw error
  }
}

/** Close admission synchronously before an asynchronous shutdown starts. */
export function beginOwnedProcessShutdown(): void {
  stopping = true
  if (process.platform === 'win32') beginWindowsOwnedProcessShutdown()
}

export function ownedProcessAdmissionClosed(): boolean { return stopping }

export function isOwnedProcess(child: ChildProcess): boolean {
  return owned.has(child) || retired.has(child) || windowsOwned.has(child)
}

/**
 * Adopt an app-created PTY leader before releasing its own launch gate. This
 * covers registered groups/job-control descendants, not unobservable daemon
 * escapes between process snapshots. Callers must retain their own gate.
 */
export async function registerOwnedProcessGroup(
  pid: number,
  options: { ownerLossGraceMs?: number; trackDescendants?: boolean } = {}
): Promise<{ stop(options?: OwnedProcessStopOptions): Promise<void> }> {
  if (process.platform === 'win32') throw new Error('External groups require native Windows job registration')
  const guard = await getGuard()
  const reference = { pid } as ChildProcess
  owned.set(reference, guard)
  try {
    await guard.request({ type: 'register', pid, ownerLossGraceMs: options.ownerLossGraceMs ?? 20_000,
      trackDescendants: options.trackDescendants === true })
    if (stopping) throw new Error('Owned process admission closed during registration')
  } catch (error) {
    await stopOwnedProcess(reference, { graceMs: 0 }).catch(() => undefined)
    throw error
  }
  return { stop: (stopOptions) => stopOwnedProcess(reference, stopOptions) }
}

/** Only an explicit new application generation may reopen launch admission. */
export function resumeOwnedProcessAdmission(): void {
  if (process.platform === 'win32') resumeWindowsOwnedProcessAdmission()
  if (owned.size || (activeGuard && activeGuard.child.exitCode === null && activeGuard.child.signalCode === null)) {
    throw new Error('Cannot reopen process admission before the previous owned stack has exited')
  }
  if (guardStarting) throw new Error('Cannot reopen admission while its guard is starting')
  stopping = false
  guardPromise = undefined
  activeGuard = undefined
  guardStartFailed = false
}

export async function stopOwnedProcess(
  child: ChildProcess,
  options: OwnedProcessStopOptions = {}
): Promise<void> {
  if (process.platform === 'win32') return stopWindowsOwnedProcess(child, options)
  const guard = owned.get(child)
  if (!guard) {
    if (retired.has(child)) return
    if (child.exitCode !== null || child.signalCode !== null) return
    throw new Error('Cannot terminate a process without owned containment')
  }
  try {
    // The request must reach the guard even when the child leader already
    // exited: remaining group members still have to be swept.
    await guard.request({
      type: 'stop', pid: child.pid,
      graceMs: options.graceMs ?? 1000,
      timeoutMs: options.timeoutMs ?? 5000
    })
  } catch (error) {
    if (!guardChildDead(guard.child)) throw error
    const pid = child.pid
    if (typeof pid !== 'number' || pid <= 1) throw error
    if (child.exitCode === null && child.signalCode === null) {
      // The guard supervising this group is already gone, so the stop
      // request can never reach it. The leader is still alive, so its pid
      // still heads its process group: signal that group directly — the
      // same action the guard would have taken — instead of stranding the
      // child. A live guard stays fail-closed.
      try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ }
    } else if (!groupGone(pid)) {
      // The leader already exited and its pid may have been recycled, so a
      // blind group signal is unsafe. Only a verified-empty group counts as
      // stopped; a live or reused group id stays fail-closed.
      throw error
    }
  }
  owned.delete(child)
  retired.add(child)
}

/** Wait for all registered groups and the session guard itself to exit. */
export async function shutdownOwnedProcesses(options: OwnedProcessShutdownOptions = {}): Promise<void> {
  beginOwnedProcessShutdown()
  if (process.platform === 'win32') return shutdownWindowsOwnedProcesses(options)
  const excluded = new Set(options.exclude ?? [])
  const results = await Promise.allSettled([...owned.keys()].filter((child) => !excluded.has(child))
    .map((child) => stopOwnedProcess(child, options)))
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Owned processes failed to exit')
  if ([...owned.keys()].some((child) => excluded.has(child))) return
  if (!guardPromise) return
  // A guard that never became ready left no registered groups behind, so
  // its failed startup promise must not fail the shutdown itself.
  const guard = await guardPromise.catch(() => undefined)
  if (!guard) return
  if (guard.child.exitCode === 0) return
  if (guard.child.exitCode !== null || guard.child.signalCode !== null) {
    throw new Error('Owned process guard exited abnormally')
  }
  const exited = new Promise<void>((accept, reject) => {
    if (guard.child.exitCode !== null || guard.child.signalCode !== null) { accept(); return }
    const timer = setTimeout(() => reject(new Error('Owned process guard failed to exit')), options.timeoutMs ?? 5000)
    guard.child.once('exit', (code) => {
      clearTimeout(timer)
      if (code && code !== 0) reject(new Error(`Owned process guard exited with ${code}`))
      else accept()
    })
  })
  await guard.request({ type: 'shutdown', graceMs: 0, timeoutMs: options.timeoutMs ?? 5000 })
  await exited
}
