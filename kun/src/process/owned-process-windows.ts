import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { WINDOWS_OWNED_LAUNCHER_SOURCE } from './owned-process-windows-launcher.js'

type StopOptions = { graceMs?: number; timeoutMs?: number }
type LaunchOptions = SpawnOptions & { ownerLossGraceMs?: number }
type Launch = { directory: string; stopPath: string; launcherPid: number; stop?: Promise<void> }
const launches = new Map<ChildProcess, Launch>()
const retired = new WeakSet<ChildProcess>()
let launcherBuild: Promise<string> | undefined
let stopping = false

export function beginWindowsOwnedProcessShutdown(): void { stopping = true }

/** CommandLineToArgvW-compatible quoting; no shell participates in exe launches. */
export function quoteWindowsArgument(value: string): string {
  if (value && !/[\s"]/u.test(value)) return value
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
}

async function buildLauncher(): Promise<string> {
  const hash = createHash('sha256').update(WINDOWS_OWNED_LAUNCHER_SOURCE).digest('hex').slice(0, 20)
  const cache = join(tmpdir(), 'kun-owned-process', hash)
  const output = join(cache, 'kun-owned-launcher.exe')
  try { await access(output); return output } catch { /* first launch */ }
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const work = await mkdtemp(join(cache, 'build-'))
  try {
    const source = join(work, 'launcher.cs')
    const compiled = join(work, 'launcher.exe')
    await writeFile(source, WINDOWS_OWNED_LAUNCHER_SOURCE, { mode: 0o600 })
    const script = '$ErrorActionPreference="Stop"; Add-Type -Path $env:KUN_LAUNCHER_SOURCE -OutputAssembly $env:KUN_LAUNCHER_OUTPUT -OutputType ConsoleApplication'
    await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 15_000,
      env: { ...process.env, KUN_LAUNCHER_SOURCE: source, KUN_LAUNCHER_OUTPUT: compiled }
    })
    try { await rename(compiled, output) } catch (error) {
      try { await access(output) } catch { throw error }
    }
    return output
  } finally { await rm(work, { recursive: true, force: true }) }
}

async function executablePath(command: string, options: SpawnOptions): Promise<string> {
  const environment = options.env ?? process.env
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path')
  const paths = /[\\/]/u.test(command) || isAbsolute(command)
    ? [resolve(String(options.cwd ?? process.cwd()), command)]
    : String(environment[pathKey ?? 'PATH'] ?? '').split(';').map((part) => join(part, command))
  const suffixes = /\.(?:exe|com|cmd|bat)$/iu.test(command) ? [''] : ['', '.exe', '.com', '.cmd', '.bat']
  for (const path of paths) for (const suffix of suffixes) {
    try { await access(path + suffix); return path + suffix } catch { /* next */ }
  }
  throw Object.assign(new Error(`Could not start executable: ${basename(command)}`), { code: 'ENOENT' })
}

async function prepareWindowsLaunch(command: string, args: readonly string[], options: LaunchOptions, console = false) {
  if (stopping) throw new Error('Owned process admission is closed')
  if (options.shell) throw new Error('Owned commands must select an explicit shell executable')
  let executable = await executablePath(command, options)
  let commandLine = [executable, ...args].map(quoteWindowsArgument).join(' ')
  if (/\.(?:cmd|bat)$/iu.test(executable)) {
    // Batch commands require cmd.exe; reject metacharacters instead of silently
    // treating a configured stdio argument as executable shell source.
    if ([executable, ...args].some((value) => /[%!&|<>^\r\n]/u.test(value))) {
      throw new Error('Use an executable or explicit shell for batch arguments containing shell metacharacters')
    }
    commandLine = `${quoteWindowsArgument(process.env.ComSpec ?? 'cmd.exe')} /d /s /c "${commandLine}"`
    executable = await executablePath(process.env.ComSpec ?? 'cmd.exe', options)
  }
  const launcher = await (launcherBuild ??= buildLauncher().catch((error) => { launcherBuild = undefined; throw error }))
  if (stopping) throw new Error('Owned process admission is closed')
  const directory = await mkdtemp(join(tmpdir(), 'kun-owned-job-'))
  const statusPath = join(directory, 'started')
  const stopPath = join(directory, 'stop')
  const startPath = join(directory, 'resume')
  const configPath = join(directory, 'launch')
  const environment = { ...(options.env ?? process.env) }
  const ownerPid = Number(environment.KUN_PROCESS_STACK_OWNER_PID) || process.pid
  const ownerBirth = environment.KUN_PROCESS_STACK_OWNER_BIRTH ?? '0'
  await writeFile(configPath, [executable, commandLine, String(options.cwd ?? process.cwd()), statusPath, stopPath]
    .map((value) => Buffer.from(value).toString('base64')).concat([
      String(ownerPid), ownerBirth, String(options.ownerLossGraceMs ?? 20_000), console ? 'console' : 'pipe',
      Buffer.from(startPath).toString('base64')
    ]).join('\n'), { mode: 0o600 })
  const { ownerLossGraceMs: _ownerLossGraceMs, ...spawnOptions } = options
  const launcherOptions: SpawnOptions = {
    ...spawnOptions, shell: false, windowsVerbatimArguments: false, detached: false, windowsHide: true,
    env: { ...environment, KUN_OWNED_LAUNCH_CONFIG: configPath }
  }
  return { launcher, launcherOptions, directory, statusPath, stopPath, startPath }
}

async function bindWindowsLaunch(child: ChildProcess, prepared: Awaited<ReturnType<typeof prepareWindowsLaunch>>): Promise<ChildProcess> {
  const { directory, statusPath, stopPath } = prepared
  let spawnError: Error | undefined
  child.on('error', (error) => { spawnError = error })
  const launch = { directory, stopPath, launcherPid: child.pid ?? 0 }
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
        // Do not await after releasing the gate: the caller installs its
        // listeners in the promise microtask before target I/O can be handled.
        writeFileSync(prepared.startPath, 'start', { mode: 0o600 })
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
  }
}

export async function spawnWindowsOwnedProcess(command: string, args: readonly string[], options: LaunchOptions): Promise<ChildProcess> {
  const prepared = await prepareWindowsLaunch(command, args, options)
  if (stopping) {
    await rm(prepared.directory, { recursive: true, force: true })
    throw new Error('Owned process admission is closed')
  }
  return bindWindowsLaunch(spawn(prepared.launcher, [], prepared.launcherOptions), prepared)
}

/** ConPTY starts the gated launcher, never an already executing uncontained shell. */
export async function prepareWindowsOwnedPty(command: string, args: readonly string[], options: LaunchOptions) {
  const prepared = await prepareWindowsLaunch(command, args, options, true)
  return {
    command: prepared.launcher,
    args: [] as string[],
    env: prepared.launcherOptions.env ?? {},
    bind: (child: ChildProcess) => bindWindowsLaunch(child, prepared),
    abort: () => rm(prepared.directory, { recursive: true, force: true })
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
    while (child.exitCode === null && child.signalCode === null && Date.now() < graceUntil) {
      await new Promise((accept) => setTimeout(accept, 25))
    }
    await writeFile(launch.stopPath, 'stop', { mode: 0o600 })
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
      await new Promise((accept) => setTimeout(accept, 25))
    }
    if (child.exitCode === null && child.signalCode === null) {
      // Native ChildProcess handle targets the launcher, not a recycled PID.
      // Closing its sole non-inherited Job handle kills every contained child.
      child.kill('SIGKILL')
      await new Promise<void>((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('Windows owned Job launcher did not exit')), 1_000)
        child.once('exit', () => { clearTimeout(timer); accept() })
      })
    }
    launches.delete(child)
    retired.add(child)
    await rm(launch.directory, { recursive: true, force: true })
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
