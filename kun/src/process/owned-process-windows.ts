import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { windowsOwnedLauncherPath } from './windows-startup-native.js'

type StopOptions = { graceMs?: number; timeoutMs?: number }
type LaunchOptions = SpawnOptions & { ownerLossGraceMs?: number; beforeLaunch?: () => Promise<unknown> }
type Launch = {
  directory: string; stopPath: string; launcherPid: number; exited: boolean
  stop?: Promise<void>; release?: Promise<void>
}
const launches = new Map<ChildProcess, Launch>()
const retired = new WeakSet<ChildProcess>()
let stopping = false

export function beginWindowsOwnedProcessShutdown(): void { stopping = true }

/** CommandLineToArgvW-compatible quoting; no shell participates in exe launches. */
export function quoteWindowsArgument(value: string): string {
  if (value && !/[\s"]/u.test(value)) return value
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
}

export async function resolveWindowsExecutablePath(command: string, options: SpawnOptions): Promise<string> {
  const environment = options.env ?? process.env
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path')
  const cwd = String(options.cwd ?? process.cwd())
  const paths = /[\\/]/u.test(command) || isAbsolute(command)
    ? [resolve(cwd, command)]
    : String(environment[pathKey ?? 'PATH'] ?? '').split(';').map((part) => resolve(cwd, part, command))
  const pathExtKey = Object.keys(environment).find((key) => key.toLowerCase() === 'pathext')
  const supported = ['.com', '.exe', '.bat', '.cmd']
  const extensions = String(environment[pathExtKey ?? 'PATHEXT'] ?? supported.join(';')).split(';')
    .map((suffix) => suffix.toLowerCase()).filter((suffix) => supported.includes(suffix))
  // npm installs a POSIX shell shim alongside .cmd/.ps1. Existence alone
  // cannot make that extensionless file a Windows executable.
  const suffixes = /\.(?:exe|com|cmd|bat)$/iu.test(command) ? [''] : extensions
  for (const path of paths) for (const suffix of suffixes) {
    try { if ((await stat(path + suffix)).isFile()) return path + suffix } catch { /* next */ }
  }
  throw Object.assign(new Error(`Could not start executable: ${basename(command)}`), { code: 'ENOENT' })
}

async function prepareWindowsLaunch(command: string, args: readonly string[], options: LaunchOptions, console = false) {
  if (stopping) throw new Error('Owned process admission is closed')
  if (options.shell) throw new Error('Owned commands must select an explicit shell executable')
  let executable = await resolveWindowsExecutablePath(command, options)
  let commandLine = [executable, ...args].map(quoteWindowsArgument).join(' ')
  if (/\.(?:cmd|bat)$/iu.test(executable)) {
    // Batch commands require cmd.exe; reject metacharacters instead of silently
    // treating a configured stdio argument as executable shell source.
    if ([executable, ...args].some((value) => /[%!&|<>^\r\n]/u.test(value))) {
      throw new Error('Use an executable or explicit shell for batch arguments containing shell metacharacters')
    }
    commandLine = `${quoteWindowsArgument(process.env.ComSpec ?? 'cmd.exe')} /d /s /c "${commandLine}"`
    executable = await resolveWindowsExecutablePath(process.env.ComSpec ?? 'cmd.exe', options)
  }
  const launcher = windowsOwnedLauncherPath()
  if (stopping) throw new Error('Owned process admission is closed')
  const directory = await mkdtemp(join(tmpdir(), 'kun-owned-job-'))
  const statusPath = join(directory, 'started')
  const stopPath = join(directory, 'stop')
  const startPath = join(directory, 'resume')
  const configPath = join(directory, 'launch')
  const environment = { ...(options.env ?? process.env) }
  const ownerPid = Number(environment.KUN_PROCESS_STACK_OWNER_PID) || process.pid
  const ownerBirth = environment.KUN_PROCESS_STACK_OWNER_BIRTH ?? '0'
  try {
    await writeFile(configPath, [executable, commandLine, String(options.cwd ?? process.cwd()), statusPath, stopPath]
      .map((value) => Buffer.from(value).toString('base64')).concat([
        String(ownerPid), ownerBirth, String(options.ownerLossGraceMs ?? 20_000), console ? 'console' : 'pipe',
        Buffer.from(startPath).toString('base64')
      ]).join('\n'), { mode: 0o600 })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  const { ownerLossGraceMs: _ownerLossGraceMs, beforeLaunch, ...spawnOptions } = options
  const launcherOptions: SpawnOptions = {
    // The supervisor must outlive an abrupt owner exit long enough to enforce
    // its drain grace. Node's non-detached Windows Job would kill it immediately.
    // Keep the handle referenced; the supervisor still owns a kill-on-close Job
    // and monitors the exact owner handle before bounded forced cleanup.
    ...spawnOptions, shell: false, windowsVerbatimArguments: false, detached: true, windowsHide: true,
    env: { ...environment, KUN_OWNED_LAUNCH_CONFIG: configPath }
  }
  return { launcher, launcherOptions, directory, statusPath, stopPath, startPath, beforeLaunch }
}

function launcherExited(child: ChildProcess, launch: Launch): boolean {
  return launch.exited || child.exitCode !== null || child.signalCode !== null
}

function releaseWindowsLaunch(child: ChildProcess, launch: Launch): Promise<void> {
  if (launch.release) return launch.release
  launch.release = rm(launch.directory, { recursive: true, force: true }).then(() => {
    launches.delete(child)
    retired.add(child)
  }).catch((error) => { launch.release = undefined; throw error })
  return launch.release
}

async function bindWindowsLaunch(child: ChildProcess, prepared: Awaited<ReturnType<typeof prepareWindowsLaunch>>,
  suspended = false): Promise<ChildProcess> {
  const { directory, statusPath, stopPath } = prepared
  let spawnError: Error | undefined
  let binding = true
  const launch: Launch = { directory, stopPath, launcherPid: child.pid ?? 0, exited: false }
  const onError = (error: Error) => {
    spawnError = error
    if (!launch.launcherPid) launch.exited = true
  }
  child.on('error', onError)
  // This is the launcher handle's exit, NOT the target PID's exit. The native
  // launcher waits for an empty Job (including surviving descendants).
  child.once('exit', () => {
    launch.exited = true
    if (!binding) void releaseWindowsLaunch(child, launch).catch(() => undefined)
  })
  launches.set(child, launch)
  try {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (stopping) throw new Error('Owned process admission closed during launch')
      const status = await readFile(statusPath, 'utf8').catch(() => '')
      if (status.startsWith('error:')) throw new Error(status.slice(6))
      if (/^[1-9]\d*$/u.test(status)) {
        // _handle still owns the launcher/Job lifetime, while callers and
        // Runtime discovery observe the real target process identity.
        Object.defineProperty(child, 'pid', { value: Number(status), configurable: true, enumerable: true })
        await prepared.beforeLaunch?.()
        if (stopping) throw new Error('Owned process admission closed during launch')
        // Do not await after releasing the gate: the caller installs its
        // listeners in the promise microtask before target I/O can be handled.
        if (launcherExited(child, launch)) throw new Error('Windows owned launcher exited before release')
        if (!suspended) writeFileSync(prepared.startPath, 'start', { mode: 0o600 })
        return child
      }
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        if (spawnError) throw spawnError
        // The launcher reports its own failure through the status file, which
        // can lag a few ms behind process exit; give it a final grace window
        // before falling back to the generic exit error.
        const lateDeadline = Date.now() + 1_000
        while (Date.now() < lateDeadline) {
          const detail = await readFile(statusPath, 'utf8').catch(() => '')
          if (detail.startsWith('error:')) throw new Error(detail.slice(6))
          await new Promise((accept) => setTimeout(accept, 25))
        }
        const stage = await readFile(`${statusPath}.stage`, 'utf8').catch(() => '')
        throw new Error(
          `Windows owned launcher exited before readiness ` +
          `(code ${child.exitCode ?? child.signalCode ?? 'unknown'}${stage ? `, last stage: ${stage}` : ''})`
        )
      }
      await new Promise((accept) => setTimeout(accept, 25))
    }
    throw new Error('Windows owned launcher timed out before readiness')
  } catch (error) {
    await stopWindowsOwnedProcess(child, { graceMs: 0, timeoutMs: 3_000 }).catch(() => undefined)
    throw error
  } finally {
    binding = false
    child.removeListener('error', onError)
    if (launcherExited(child, launch)) await releaseWindowsLaunch(child, launch)
  }
}

export async function spawnWindowsOwnedProcess(command: string, args: readonly string[], options: LaunchOptions): Promise<ChildProcess> {
  const prepared = await prepareWindowsLaunch(command, args, options)
  try {
    await prepared.beforeLaunch?.()
    if (stopping) throw new Error('Owned process admission is closed')
  } catch (error) {
    await rm(prepared.directory, { recursive: true, force: true })
    throw error
  }
  try {
    return await bindWindowsLaunch(spawn(prepared.launcher, [], prepared.launcherOptions), prepared)
  } catch (error) {
    // A synchronous spawn failure has no launcher/Job to stop.
    // Bound failures retain their registration until the launcher really exits.
    if (![...launches.values()].some((launch) => launch.directory === prepared.directory)) {
      await rm(prepared.directory, { recursive: true, force: true })
    }
    throw error
  }
}

/** ConPTY starts the gated launcher, never an already executing uncontained shell. */
export async function prepareWindowsOwnedPty(command: string, args: readonly string[], options: LaunchOptions) {
  const prepared = await prepareWindowsLaunch(command, args, options, true)
  let child: ChildProcess | undefined
  let ready = false
  let released = false
  return {
    command: prepared.launcher,
    args: [] as string[],
    env: prepared.launcherOptions.env ?? {},
    bind: async (facade: ChildProcess) => {
      child = facade
      await bindWindowsLaunch(facade, prepared, true)
      ready = true
      return facade
    },
    release: () => {
      if (released) return
      if (!ready || !child) throw new Error('Windows owned PTY is not ready')
      const launch = launches.get(child)
      if (stopping || !launch || launcherExited(child, launch)) throw new Error('Windows owned PTY cannot resume')
      writeFileSync(prepared.startPath, 'start', { mode: 0o600 })
      released = true
    },
    abort: () => child ? stopWindowsOwnedProcess(child, { graceMs: 0 })
      : rm(prepared.directory, { recursive: true, force: true })
  }
}

export async function stopWindowsOwnedProcess(child: ChildProcess, options: StopOptions = {}): Promise<void> {
  const launch = launches.get(child)
  if (!launch) {
    if (retired.has(child)) return
    throw new Error('Cannot terminate a process without an owned Windows Job')
  }
  if (launch.stop) return launch.stop
  launch.stop = (async () => {
    const deadline = Date.now() + (options.timeoutMs ?? 5_000)
    const graceUntil = Math.min(deadline, Date.now() + (options.graceMs ?? 0))
    while (!launcherExited(child, launch) && Date.now() < graceUntil) {
      await new Promise((accept) => setTimeout(accept, 25))
    }
    if (!launcherExited(child, launch)) {
      try { await writeFile(launch.stopPath, 'stop', { mode: 0o600 }) }
      catch (error) { if (!launcherExited(child, launch)) throw error }
    }
    while (!launcherExited(child, launch) && Date.now() < deadline) {
      await new Promise((accept) => setTimeout(accept, 25))
    }
    if (!launcherExited(child, launch)) {
      // Native ChildProcess handle targets the launcher, not a recycled PID.
      // Closing its sole non-inherited Job handle kills every contained child.
      child.kill('SIGKILL')
      const killDeadline = Date.now() + 1_000
      while (!launcherExited(child, launch) && Date.now() < killDeadline) {
        await new Promise((accept) => setTimeout(accept, 25))
      }
      if (!launcherExited(child, launch)) throw new Error('Windows owned Job launcher did not exit')
    }
    await releaseWindowsLaunch(child, launch)
  })().catch((error) => { launch.stop = undefined; throw error })
  return launch.stop
}

export async function shutdownWindowsOwnedProcesses(options: StopOptions & { exclude?: readonly ChildProcess[] } = {}): Promise<void> {
  stopping = true
  const excluded = new Set(options.exclude ?? [])
  const results = await Promise.allSettled([...launches.keys()].filter((child) => !excluded.has(child))
    .map((child) => stopWindowsOwnedProcess(child, options)))
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (errors.length) throw new AggregateError(errors.map((result) => result.reason), 'Owned Windows Jobs failed to exit')
}

export function resumeWindowsOwnedProcessAdmission(): void {
  if (launches.size) throw new Error('Windows owned Jobs have not finished shutting down')
  stopping = false
}
