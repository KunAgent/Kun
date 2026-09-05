import { existsSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createRequire } from 'node:module'
import { posix, win32 } from 'node:path'
import type { ShellConfig } from './builtin-tool-types.js'
import { resolveWindowsShellCandidates, WINDOWS_POWERSHELL_COMMAND_ARGS, windowsSystemRoot } from './windows-shell-resolver.js'

type SpawnSyncLike = typeof spawnSync
type SpawnLike = typeof spawn
const runtimeRequire = createRequire(import.meta.url)
const POWERSHELL_UTF8_OUTPUT_PREAMBLE = [
  '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = $OutputEncoding',
  'try { [Console]::InputEncoding = $OutputEncoding } catch {}'
].join('; ')

function lookupResults(
  lookup: SpawnSyncLike,
  command: string,
  args: string[]
): string[] {
  try {
    const result = lookup(command, args, { encoding: 'utf8' })
    if (result.status !== 0) return []
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function firstLookupResult(
  lookup: SpawnSyncLike,
  command: string,
  args: string[]
): string {
  return lookupResults(lookup, command, args)[0] ?? ''
}

export type ShellRuntimeInfo = ShellConfig & {
  name: string
  syntax: string
}

export type ShellRuntimePlan = {
  primary: ShellRuntimeInfo
  candidates: readonly ShellRuntimeInfo[]
}

export type ShellRuntimePlanOptions = {
  platform?: NodeJS.Platform
  lookup?: SpawnSyncLike
  fileExists?: (path: string) => boolean
  env?: NodeJS.ProcessEnv
}

function pathExists(fileExists: (path: string) => boolean, candidate: string): boolean {
  try {
    return fileExists(candidate)
  } catch {
    return false
  }
}

function uniqueShellConfigs(configs: ShellConfig[], platform: NodeJS.Platform): ShellConfig[] {
  const seen = new Set<string>()
  return configs.filter((config) => {
    if (!config.shell.trim()) return false
    const normalized = config.shell.replace(/[\\/]+$/, '')
    const key = platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function runtimePlan(configs: ShellConfig[], platform: NodeJS.Platform): ShellRuntimePlan {
  const candidates = uniqueShellConfigs(configs, platform).map((config) => shellRuntimeInfo(config))
  const primary = candidates[0]
  if (!primary) throw new Error('shell runtime plan requires at least one candidate')
  return { primary, candidates }
}

export function shellRuntimePlan(options: ShellRuntimePlanOptions = {}): ShellRuntimePlan {
  const platform = options.platform ?? process.platform

  if (platform === 'win32') {
    const resolverOptions = {
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(options.fileExists ? { fileExists: options.fileExists } : {}),
      ...(options.env ? { env: options.env } : {})
    }
    return runtimePlan(
      resolveWindowsShellCandidates(resolverOptions)
        .map((candidate) => ({ shell: candidate.file, args: [...candidate.commandArgs] })),
      platform
    )
  }

  const lookup = options.lookup ?? spawnSync
  const fileExists = options.fileExists ?? existsSync
  const configs: ShellConfig[] = []
  if (pathExists(fileExists, '/bin/bash')) configs.push({ shell: '/bin/bash', args: ['-lc'] })
  for (const shell of lookupResults(lookup, 'which', ['bash'])) configs.push({ shell, args: ['-lc'] })
  configs.push({ shell: 'sh', args: ['-lc'] })
  return runtimePlan(configs, platform)
}

export function shellConfig(
  platform?: NodeJS.Platform,
  lookup?: SpawnSyncLike,
  fileExists?: (path: string) => boolean,
  env?: NodeJS.ProcessEnv
): ShellConfig {
  const { shell, args } = shellRuntimePlan({
    ...(platform ? { platform } : {}),
    ...(lookup ? { lookup } : {}),
    ...(fileExists ? { fileExists } : {}),
    ...(env ? { env } : {})
  }).primary
  return { shell, args }
}

const SAFE_SHELL_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'KUN_RUNTIME_INSTANCE_ID',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR'
])

const SAFE_WINDOWS_SHELL_ENV_KEYS = new Set([
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'USERNAME'
])

function copySafeShellEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const normalized = platform === 'win32' ? key.toUpperCase() : key
    const allowed = SAFE_SHELL_ENV_KEYS.has(normalized) ||
      normalized.startsWith('LC_') ||
      (platform === 'win32' && SAFE_WINDOWS_SHELL_ENV_KEYS.has(normalized))
    if (allowed) result[key] = value
  }
  return result
}

// Environment for agent-controlled shell commands. It deliberately passes a
// small execution allow-list instead of inheriting the runtime's environment:
// the serve process holds its bearer token and model credentials, while a
// shell, verifier, operation, hook, or SDK child must never be able to print
// them into a tool result. On Windows, also guarantee the core system
// directories are on PATH so built-in utilities (`where`, `findstr`,
// `tasklist`, …) and PATH-resolved tools (`node`, `npm`, `python`) remain
// reachable from inside the shell even when the app inherited a PATH without
// System32. The directories are appended (never prepended), so the user's own
// PATH entries keep their precedence.
export function shellSpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const safeEnv = copySafeShellEnvironment(env, platform)
  if (platform !== 'win32') return safeEnv
  const systemRoot = windowsSystemRoot(safeEnv)
  const required = [
    win32.join(systemRoot, 'System32'),
    systemRoot,
    win32.join(systemRoot, 'System32', 'Wbem'),
    win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  ]
  // PATH casing varies on Windows (PATH vs Path); update the key as it exists.
  const pathKey = Object.keys(safeEnv).find((key) => key.toLowerCase() === 'path') ?? 'Path'
  const existing = (safeEnv[pathKey] ?? '').split(win32.delimiter).filter(Boolean)
  const seen = new Set(existing.map((entry) => entry.toLowerCase().replace(/[\\/]+$/, '')))
  const missing = required.filter((dir) => !seen.has(dir.toLowerCase()))
  if (missing.length === 0) return safeEnv
  return {
    ...safeEnv,
    [pathKey]: [...existing, ...missing].join(win32.delimiter)
  }
}

export function shellDisplayName(shell: string): string {
  const name = shell.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? shell.toLowerCase()
  if (name === 'cmd.exe') return 'cmd.exe'
  return name.endsWith('.exe') ? name.slice(0, -4) : name
}

export function shellRuntimeInfo(config: ShellConfig = shellConfig()): ShellRuntimeInfo {
  const name = shellDisplayName(config.shell)
  return {
    ...config,
    name,
    syntax: shellSyntaxHint(name)
  }
}

export function shellCommandArgs(config: ShellConfig, command: string): string[] {
  const name = shellDisplayName(config.shell)
  if (name === 'pwsh' || name === 'powershell') {
    const script = `${POWERSHELL_UTF8_OUTPUT_PREAMBLE}\n${command}`
    return [...WINDOWS_POWERSHELL_COMMAND_ARGS, script]
  }
  return [...config.args, command]
}

export type ShellSpawnAttempt = {
  shell: string
  name: string
  code?: string
  errno?: string | number
  syscall?: string
}

export class ShellSpawnError extends Error {
  readonly attempts: readonly ShellSpawnAttempt[]
  readonly code?: string
  readonly errno?: string | number
  readonly syscall?: string

  constructor(attempts: readonly ShellSpawnAttempt[]) {
    const copiedAttempts = attempts.map((attempt) => ({ ...attempt }))
    const summary = copiedAttempts
      .map((attempt) => `${attempt.name}: ${attempt.code ?? 'UNKNOWN'}`)
      .join(', ')
    super(`Failed to start shell${summary ? ` (${summary})` : ''}`)
    this.name = 'ShellSpawnError'
    this.attempts = copiedAttempts
    const last = copiedAttempts.at(-1)
    this.code = last?.code
    this.errno = last?.errno
    this.syscall = last?.syscall
  }

  toJSON(): {
    name: string
    message: string
    code?: string
    errno?: string | number
    syscall?: string
    attempts: readonly ShellSpawnAttempt[]
  } {
    return {
      name: this.name,
      message: this.message,
      ...(this.code ? { code: this.code } : {}),
      ...(this.errno !== undefined ? { errno: this.errno } : {}),
      ...(this.syscall ? { syscall: this.syscall } : {}),
      attempts: this.attempts
    }
  }
}

export type ShellCommandSpawnOptions = Omit<SpawnOptions, 'cwd' | 'env' | 'shell'> & {
  cwd: string
  env?: NodeJS.ProcessEnv
}

export type ShellCommandRunnerOptions = ShellRuntimePlanOptions & {
  plan?: ShellRuntimePlan
  spawnImpl?: SpawnLike
}

export type SpawnedShellCommand = {
  child: ChildProcess
  runtime: ShellRuntimeInfo
}

export type ShellCommandRunner = {
  runtime: ShellRuntimeInfo
  candidates: readonly ShellRuntimeInfo[]
  spawn: (command: string, options: ShellCommandSpawnOptions) => Promise<SpawnedShellCommand>
}

function spawnAttempt(runtime: ShellRuntimeInfo, error: unknown): ShellSpawnAttempt {
  const nodeError = error && typeof error === 'object' ? error as NodeJS.ErrnoException : undefined
  return {
    shell: runtime.shell,
    name: runtime.name,
    ...(typeof nodeError?.code === 'string' ? { code: nodeError.code } : {}),
    ...(typeof nodeError?.errno === 'number' || typeof nodeError?.errno === 'string'
      ? { errno: nodeError.errno }
      : {}),
    ...(typeof nodeError?.syscall === 'string' ? { syscall: nodeError.syscall } : {})
  }
}

function waitForSpawn(child: ChildProcess): Promise<ChildProcess> {
  return new Promise((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      child.off('spawn', onSpawn)
      child.off('error', onError)
    }
    const onSpawn = () => {
      cleanup()
      resolvePromise(child)
    }
    const onError = (error: Error) => {
      cleanup()
      rejectPromise(error)
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

export function createShellCommandRunner(options: ShellCommandRunnerOptions = {}): ShellCommandRunner {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const resolvedPlan = options.plan ?? shellRuntimePlan(options)
  // Never replay one command under another syntax family after a launch
  // failure. PowerShell, POSIX, and cmd parse the same text differently.
  const candidates = uniqueShellConfigs(
    [resolvedPlan.primary, ...resolvedPlan.candidates]
      .filter((runtime) => runtime.syntax === resolvedPlan.primary.syntax),
    platform
  ).map((config) => shellRuntimeInfo(config))
  const primary = candidates[0] ?? resolvedPlan.primary
  const spawnImpl = options.spawnImpl ?? spawn

  return {
    runtime: primary,
    candidates,
    async spawn(command, spawnOptions) {
      const attempts: ShellSpawnAttempt[] = []
      const safeEnv = shellSpawnEnv(spawnOptions.env ?? env, platform)
      const baseChildOptions: SpawnOptions = {
        ...spawnOptions,
        windowsHide: spawnOptions.windowsHide ?? true,
        shell: false
      }
      for (const runtime of candidates) {
        try {
          const childOptions: SpawnOptions = {
            ...baseChildOptions,
            env: platform === 'win32' && runtime.name === 'bash'
              ? { ...safeEnv, CHERE_INVOKING: '1' }
              : safeEnv
          }
          const child = spawnImpl(runtime.shell, shellCommandArgs(runtime, command), childOptions)
          await waitForSpawn(child)
          return { child, runtime }
        } catch (error) {
          // An error before the spawn event means no process was created, so a
          // same-syntax fallback cannot duplicate side effects.
          attempts.push(spawnAttempt(runtime, error))
        }
      }
      throw new ShellSpawnError(attempts)
    }
  }
}

// Factual environment block, not an instruction. Modeled on Codex's
// <environment_context>: state the shell as a fact and let the model infer
// the syntax, rather than issuing imperative "write PowerShell / do not assume
// POSIX" directives that the model echoes back even on a bare greeting. The
// `bash` tool's own description already covers session_id/poll/write/stop and
// dev-server usage, so we don't repeat it here.
export function shellRuntimeInstruction(config: ShellConfig = shellConfig()): string {
  const shell = shellRuntimeInfo(config)
  return [
    '<shell_environment>',
    `  <shell>${shell.name}</shell>`,
    `  <path>${shell.shell}</path>`,
    `  <syntax>${shell.syntax}</syntax>`,
    '</shell_environment>'
  ].join('\n')
}

// `close` can be held open by background grandchildren that inherit stdio.
// Treat the shell's `exit` as command completion, then briefly flush output.
export async function waitForSpawnExit(
  child: ChildProcess,
  options: { flushAfterExitMs?: number } = {}
): Promise<number | null> {
  const flushAfterExitMs = options.flushAfterExitMs ?? 50
  let closeCode: number | null | undefined
  let closeSeen = false

  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code) => {
      closeSeen = true
      closeCode = code
      resolvePromise(code)
    })
    child.once('exit', (code) => {
      resolvePromise(code)
    })
  })

  if (!closeSeen && flushAfterExitMs > 0) {
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(resolvePromise, flushAfterExitMs)
      child.once('close', (code) => {
        closeSeen = true
        closeCode = code
        clearTimeout(timer)
        resolvePromise()
      })
    })
  }

  if (!closeSeen) {
    child.stdout?.destroy()
    child.stderr?.destroy()
  }

  return closeCode ?? exitCode
}

export function terminateSpawnTree(
  child: ChildProcess,
  options: {
    platform?: NodeJS.Platform
    signal?: NodeJS.Signals
    spawnImpl?: SpawnLike
  } = {}
): ChildProcess | undefined {
  const signal = options.signal ?? 'SIGTERM'
  const pid = child.pid
  if (!pid) {
    child.kill(signal)
    return undefined
  }

  if ((options.platform ?? process.platform) === 'win32') {
    try {
      const taskkill = (options.spawnImpl ?? spawn)('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
      taskkill.once('error', () => {
        child.kill(signal)
      })
      taskkill.unref?.()
      return taskkill
    } catch {
      child.kill(signal)
      return undefined
    }
  }

  try {
    process.kill(-pid, signal)
    return undefined
  } catch {
    child.kill(signal)
    return undefined
  }
}

function shellSyntaxHint(name: string): string {
  switch (name) {
    case 'bash':
    case 'sh':
    case 'zsh':
      return 'POSIX shell'
    case 'pwsh':
    case 'powershell':
      return 'PowerShell'
    case 'cmd.exe':
      return 'cmd.exe batch'
    default:
      return `${name} shell`
  }
}

export function resolveExecutable(
  candidates: string[],
  platform: NodeJS.Platform = process.platform,
  lookup: SpawnSyncLike = spawnSync,
  fileExists: (path: string) => boolean = existsSync,
  responds: (candidate: string) => boolean = executableResponds
): string | null {
  const lookupCommand = platform === 'win32' ? 'where' : 'which'
  for (const candidate of candidates) {
    const isExplicitPath = candidate.includes('/') || candidate.includes('\\')
    if (isExplicitPath && fileExists(candidate) && responds(candidate)) return candidate
    if (!isExplicitPath) {
      const resolved = firstLookupResult(lookup, lookupCommand, [candidate])
      if (resolved && responds(resolved)) return resolved
    }
  }
  return null
}

export type CursorSdkRipgrepResolverOptions = {
  platform?: NodeJS.Platform
  arch?: string
  /** Test seam for resolving the packaged platform dependency without PATH. */
  resolvePackage?: (specifier: string) => string
  fileExists?: (path: string) => boolean
  responds?: (candidate: string) => boolean
}

export type RipgrepExecutableResolverOptions = CursorSdkRipgrepResolverOptions & {
  candidates?: string[]
  lookup?: SpawnSyncLike
  /** Disable only for bounded callers that must not depend on PATH. */
  allowPathFallback?: boolean
}

const cursorSdkRipgrepCache = new Map<string, string | null>()

/**
 * Maps the current Node target to Cursor SDK's optional platform package.
 * The SDK owns these binaries, so resolving its package manifest is reliable
 * in both source checkouts and Electron's unpacked application resources.
 */
export function cursorSdkRipgrepPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | null {
  if (!['darwin', 'linux', 'win32'].includes(platform)) return null
  if (arch !== 'x64' && arch !== 'arm64') return null
  // Cursor currently publishes no Windows ARM64 binary.
  if (platform === 'win32' && arch !== 'x64') return null
  return `@cursor/sdk-${platform}-${arch}`
}

/**
 * Resolves Cursor SDK's bundled ripgrep by module location, never through
 * PATH. This is important for Electron launches, whose inherited PATH is
 * commonly much smaller than an interactive shell's PATH.
 */
export function resolveCursorSdkRipgrep(options: CursorSdkRipgrepResolverOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const packageName = cursorSdkRipgrepPackageName(platform, arch)
  if (!packageName) return null
  const cacheKey = `${platform}:${arch}`
  const usesRuntimeDefaults = !options.resolvePackage && !options.fileExists && !options.responds
  if (usesRuntimeDefaults && cursorSdkRipgrepCache.has(cacheKey)) {
    return cursorSdkRipgrepCache.get(cacheKey) ?? null
  }
  const resolvePackage = options.resolvePackage ?? ((specifier: string) => runtimeRequire.resolve(specifier))
  const fileExists = options.fileExists ?? existsSync
  const responds = options.responds ?? executableResponds
  let resolved: string | null = null
  try {
    const manifestPath = resolvePackage(`${packageName}/package.json`)
    const pathApi = platform === 'win32' ? win32 : posix
    const binaryPath = pathApi.join(
      pathApi.dirname(manifestPath),
      'bin',
      platform === 'win32' ? 'rg.exe' : 'rg'
    )
    if (fileExists(binaryPath) && responds(binaryPath)) resolved = binaryPath
  } catch {
    // Optional platform dependencies are intentionally absent on unsupported
    // targets and source installations can omit optional packages.
  }
  if (usesRuntimeDefaults) cursorSdkRipgrepCache.set(cacheKey, resolved)
  return resolved
}

/** Prefer the packaged Cursor SDK binary, then preserve normal executable fallback. */
export function resolveRipgrepExecutable(options: RipgrepExecutableResolverOptions = {}): string | null {
  const bundled = resolveCursorSdkRipgrep(options)
  if (bundled) return bundled
  if (options.allowPathFallback === false) return null
  return resolveExecutable(
    options.candidates ?? ['rg'],
    options.platform,
    options.lookup,
    options.fileExists,
    options.responds
  )
}

function executableResponds(candidate: string): boolean {
  const probe = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 1000
  })
  return !probe.error && probe.status === 0
}

/** Combined stdout/stderr ceiling for helper subprocesses such as rg and git. */
export const DEFAULT_SPAWN_CAPTURE_MAX_BYTES = 1024 * 1024

export async function spawnCapture(
  file: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal; maxOutputBytes?: number; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number | null; outputTruncated: boolean; timedOut: boolean }> {
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_SPAWN_CAPTURE_MAX_BYTES)
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: shellSpawnEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let outputBytes = 0
  let outputTruncated = false
  let outputTerminationRequested = false
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const stopForOutputLimit = () => {
    if (outputTerminationRequested) return
    outputTerminationRequested = true
    terminateSpawnTree(child)
    // A malicious helper can ignore SIGTERM. Escalate shortly afterward so a
    // capped capture also releases its process and pipe resources.
    forceKillTimer = setTimeout(() => terminateSpawnTree(child, { signal: 'SIGKILL' }), 250)
    forceKillTimer.unref?.()
  }
  const appendOutput = (target: Buffer[], chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const remaining = Math.max(0, maxOutputBytes - outputBytes)
    if (remaining > 0) {
      const kept = buffer.subarray(0, Math.min(buffer.length, remaining))
      target.push(kept)
      outputBytes += kept.length
    }
    if (buffer.length > remaining) {
      outputTruncated = true
      stopForOutputLimit()
    }
  }
  const onAbort = () => terminateSpawnTree(child)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeoutMs = options.timeoutMs === undefined
    ? undefined
    : normalizePositiveInteger(options.timeoutMs, 1)
  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true
      stopForOutputLimit()
    }, timeoutMs)
    timeoutTimer.unref?.()
  }
  child.stdout?.on('data', (chunk: Buffer | string) => {
    appendOutput(stdout, chunk)
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    appendOutput(stderr, chunk)
  })
  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code) => resolvePromise(code))
  }).finally(() => {
    options.signal?.removeEventListener('abort', onAbort)
    if (forceKillTimer) clearTimeout(forceKillTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
  })
  if (options.signal?.aborted) throw new Error('command aborted')
  return {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    exitCode,
    outputTruncated,
    timedOut
  }
}


export function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
