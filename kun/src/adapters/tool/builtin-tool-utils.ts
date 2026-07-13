import { existsSync } from 'node:fs'
import { lstat, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { effectiveSandboxMode } from './sandbox-policy.js'
import { isBackgroundShellOutputPath } from '../../services/background-shell-output.js'
import type {
  EditInstruction,
  FsStats,
  ImageDetection,
  ListEntry,
  ReadClassification,
  ResizedImageResult,
  ShellConfig,
  TruncateMode
} from './builtin-tool-types.js'
import { COMPACT_RESOURCE_FILE_NAMES } from './builtin-tool-types.js'

type SpawnSyncLike = typeof spawnSync
type SpawnLike = typeof spawn
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

export async function withToolBoundary(
  run: () => Promise<{ output: unknown; isError?: boolean }>
): Promise<{ output: unknown; isError?: boolean }> {
  try {
    return await run()
  } catch (error) {
    return {
      output: {
        error: error instanceof Error ? error.message : String(error)
      },
      isError: true
    }
  }
}

export function workspaceRoot(workspace: string): string {
  if (!workspace.trim()) return process.cwd()
  return isAbsolute(workspace) ? resolve(workspace) : resolve(process.cwd(), workspace)
}

export async function resolveWorkspacePath(
  inputPath: string,
  context: ToolHostContext,
  options: { enforceWorkspaceBoundary?: boolean } = {}
): Promise<{
  workspaceRoot: string
  absolutePath: string
  relativePath: string
}> {
  const root = workspaceRoot(context.workspace)
  const lexicalAbsolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
  if (
    !options.enforceWorkspaceBoundary &&
    isBackgroundShellOutputPath(lexicalAbsolutePath, {
      runtimeDataDir: context.runtimeDataDir,
      threadId: context.threadId
    })
  ) {
    return {
      workspaceRoot: root,
      absolutePath: resolve(lexicalAbsolutePath),
      relativePath: normalizeToolPath(relative(root, resolve(lexicalAbsolutePath)) || '.')
    }
  }
  // In full-access mode the workspace boundary is not enforced: the user has
  // explicitly opted into reaching paths outside the workspace. This mirrors
  // canWritePath(), which already permits writes anywhere under
  // danger-full-access, and lets read/ls/find/grep/lsp reach system paths
  // (e.g. C:\Windows on Windows, /etc on POSIX) instead of failing with
  // "path escapes the workspace root".
  if (
    !options.enforceWorkspaceBoundary &&
    (effectiveSandboxMode(context) === 'danger-full-access' ||
      context.approvedExternalPaths?.some((path) => samePath(path, lexicalAbsolutePath)) === true)
  ) {
    return {
      workspaceRoot: root,
      absolutePath: lexicalAbsolutePath,
      relativePath: normalizeToolPath(relative(root, lexicalAbsolutePath) || '.')
    }
  }
  const resolvedRoot = await safeRealpath(root)
  if (resolvedRoot === null) {
    // Workspace root itself does not exist; nothing to anchor the escape
    // check against. This is distinct from an actual escape (handled below).
    throw new Error(`workspace root does not exist: ${root}`)
  }
  const resolvedAbsolute = await resolveSymlinkSafe(lexicalAbsolutePath)
  const resolvedRelative = relative(resolvedRoot, resolvedAbsolute)
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${sep}`) || isAbsolute(resolvedRelative)) {
    throw new Error(`path escapes the workspace root: ${inputPath}`)
  }
  // Return LEXICAL paths to callers. The realpath-resolved pair is only used
  // for the escape check above; downstream code (subprocess cwd, display
  // paths, language-server init) expects the user-facing workspace path,
  // which on symlinked roots (e.g. macOS `/tmp` -> `/private/tmp`) would
  // otherwise diverge from what the user typed and break display layers.
  return {
    workspaceRoot: root,
    absolutePath: lexicalAbsolutePath,
    relativePath: normalizeToolPath(relative(root, lexicalAbsolutePath) || '.')
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => resolve(value).replace(/[\\/]+$/, '')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

async function safeRealpath(target: string): Promise<string | null> {
  try {
    return await realpath(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    if (code === 'EACCES' || code === 'ELOOP' || code === 'ENOTDIR') return null
    throw error
  }
}

// Whether `target` is itself a symbolic link, without following it. Returns
// false when the entry is absent or cannot be stat-ed (treated as "not a link"
// — the escape check still anchors against the nearest existing ancestor).
async function isSymlink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink()
  } catch {
    return false
  }
}

async function resolveSymlinkSafe(lexicalPath: string, depth = 0): Promise<string> {
  // Guard against symlink loops (dangling link A -> B -> A never resolves).
  if (depth > 40) {
    throw new Error(`too many symbolic links resolving: ${lexicalPath}`)
  }
  const direct = await safeRealpath(lexicalPath)
  if (direct !== null) return direct
  // Target doesn't fully resolve — either a genuinely missing path (write/create
  // case) or a *dangling* symlink whose target is absent. `realpath` reports
  // both as ENOENT, so we must walk the components ourselves: anchor on the
  // nearest existing ancestor, but if a non-resolving component is actually a
  // symlink, follow it explicitly so the redirection is reflected in the escape
  // check. Re-anchoring a dangling symlink lexically (the old behavior) let a
  // planted link like `<ws>/evil -> /etc/passwd` (target absent) pass as an
  // in-workspace path and escape on the subsequent write.
  const segments: string[] = []
  let current = lexicalPath
  // Guard against pathological component counts.
  for (let i = 0; i < 128 && current !== dirname(current); i += 1) {
    const resolved = await safeRealpath(current)
    if (resolved !== null) {
      return segments.length > 0 ? resolve(resolved, ...segments) : resolved
    }
    if (await isSymlink(current)) {
      // Dangling (or otherwise non-resolving) symlink: follow its target so the
      // redirection is reflected, then re-resolve the target plus the suffix
      // collected below this component.
      const linkTarget = await readlink(current)
      const resolvedParent = (await safeRealpath(dirname(current))) ?? dirname(current)
      const followed = isAbsolute(linkTarget) ? resolve(linkTarget) : resolve(resolvedParent, linkTarget)
      const rejoined = segments.length > 0 ? resolve(followed, ...segments) : followed
      return resolveSymlinkSafe(rejoined, depth + 1)
    }
    segments.unshift(basename(current))
    current = dirname(current)
  }
  // Nothing on the path exists; treat as escape.
  throw new Error(`path escapes the workspace root: ${lexicalPath}`)
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

export function detectImageMimeType(buffer: Buffer): ImageDetection | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (buffer.length >= 24) {
      return {
        mimeType: 'image/png',
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      }
    }
    return { mimeType: 'image/png' }
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3 && size >= 7) {
        return {
          mimeType: 'image/jpeg',
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        }
      }
      offset += 2 + size
    }
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') {
      if (buffer.length >= 10) {
        return {
          mimeType: 'image/gif',
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8)
        }
      }
      return { mimeType: 'image/gif' }
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    if (buffer.length >= 30 && buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
      return {
        mimeType: 'image/webp',
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      }
    }
    return { mimeType: 'image/webp' }
  }
  return null
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join('/')
}

export function getReadClassification(absolutePath: string, workspace: string): ReadClassification | undefined {
  const fileName = basename(absolutePath)
  if (fileName === 'SKILL.md') {
    return { kind: 'skill', label: basename(dirname(absolutePath)) || fileName }
  }
  if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
    return {
      kind: 'resource',
      label: toPosixPath(relative(workspaceRoot(workspace), absolutePath) || fileName)
    }
  }
  const relativePath = toPosixPath(relative(workspaceRoot(workspace), absolutePath))
  if (relativePath === 'README.md' || relativePath.startsWith('docs/') || relativePath.startsWith('examples/')) {
    return { kind: 'docs', label: relativePath }
  }
  return undefined
}

export function formatDimensionNote(image: ResizedImageResult): string | undefined {
  if (!image.wasResized || !image.originalWidth || !image.originalHeight) return undefined
  const scale = image.originalWidth / image.width
  return `[Image: original ${image.originalWidth}x${image.originalHeight}, displayed at ${image.width}x${image.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`
}

export function describeKind(mode: TruncateMode): string {
  return mode === 'head' ? 'first' : 'last'
}

const WINDOWS_POWERSHELL_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']

// `%SystemRoot%` (a.k.a. `%windir%`) — the Windows install directory. Always
// present in a sane environment; the literal fallback covers the rare case
// where even that has been stripped from the spawned process's env.
function windowsSystemRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.SystemRoot || env.windir || env.SYSTEMROOT || 'C:\\Windows'
}

// Absolute path to cmd.exe. `%ComSpec%` is the canonical pointer the OS itself
// uses; fall back to System32\cmd.exe so we never depend on PATH resolution.
function windowsComSpec(env: NodeJS.ProcessEnv = process.env): string {
  return env.ComSpec || env.COMSPEC || win32.join(windowsSystemRoot(env), 'System32', 'cmd.exe')
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

function isWindowsAppsAlias(candidate: string): boolean {
  return /(?:^|[\\/])windowsapps(?:[\\/]|$)/i.test(candidate)
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

function windowsPowerShellConfigs(
  lookup: SpawnSyncLike,
  fileExists: (path: string) => boolean,
  env: NodeJS.ProcessEnv
): ShellConfig[] {
  const configs: ShellConfig[] = []
  const programFilesRoots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
  for (const root of programFilesRoots) {
    const pwsh = win32.join(root, 'PowerShell', '7', 'pwsh.exe')
    if (pathExists(fileExists, pwsh)) configs.push({ shell: pwsh, args: WINDOWS_POWERSHELL_ARGS })
  }

  for (const pwsh of lookupResults(lookup, 'where', ['pwsh.exe'])) {
    // WindowsApps execution aliases are not reliable launchable executables
    // from a packaged Electron process.
    if (!isWindowsAppsAlias(pwsh)) configs.push({ shell: pwsh, args: WINDOWS_POWERSHELL_ARGS })
  }

  const windowsPowerShell = win32.join(
    windowsSystemRoot(env),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  if (pathExists(fileExists, windowsPowerShell)) {
    configs.push({ shell: windowsPowerShell, args: WINDOWS_POWERSHELL_ARGS })
  }

  for (const powershell of lookupResults(lookup, 'where', ['powershell.exe'])) {
    if (!isWindowsAppsAlias(powershell)) {
      configs.push({ shell: powershell, args: WINDOWS_POWERSHELL_ARGS })
    }
  }
  return uniqueShellConfigs(configs, 'win32')
}

export function shellRuntimePlan(options: ShellRuntimePlanOptions = {}): ShellRuntimePlan {
  const platform = options.platform ?? process.platform
  const lookup = options.lookup ?? spawnSync
  const fileExists = options.fileExists ?? existsSync
  const env = options.env ?? process.env

  if (platform === 'win32') {
    const powershells = windowsPowerShellConfigs(lookup, fileExists, env)
    if (powershells.length > 0) return runtimePlan(powershells, platform)

    const bashes = lookupResults(lookup, 'where', ['bash.exe'])
      .filter((candidate) => !isWindowsAppsAlias(candidate))
      .map((shell) => ({ shell, args: ['-lc'] }))
    if (bashes.length > 0) return runtimePlan(bashes, platform)

    // Keep cmd fallbacks in one syntax family and retain the canonical system
    // path after a possibly broken ComSpec entry.
    return runtimePlan([
      { shell: windowsComSpec(env), args: ['/d', '/s', '/c'] },
      { shell: win32.join(windowsSystemRoot(env), 'System32', 'cmd.exe'), args: ['/d', '/s', '/c'] }
    ], platform)
  }

  const configs: ShellConfig[] = []
  if (pathExists(fileExists, '/bin/bash')) configs.push({ shell: '/bin/bash', args: ['-lc'] })
  for (const shell of lookupResults(lookup, 'which', ['bash'])) configs.push({ shell, args: ['-lc'] })
  configs.push({ shell: 'sh', args: ['-lc'] })
  return runtimePlan(configs, platform)
}

export function shellConfig(
  platform: NodeJS.Platform = process.platform,
  lookup: SpawnSyncLike = spawnSync,
  fileExists: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env
): ShellConfig {
  const { shell, args } = shellRuntimePlan({ platform, lookup, fileExists, env }).primary
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
    return [...WINDOWS_POWERSHELL_ARGS, script]
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
      const childOptions: SpawnOptions = {
        ...spawnOptions,
        env: shellSpawnEnv(spawnOptions.env ?? env, platform),
        windowsHide: spawnOptions.windowsHide ?? true,
        shell: false
      }
      for (const runtime of candidates) {
        try {
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
): void {
  const signal = options.signal ?? 'SIGTERM'
  const pid = child.pid
  if (!pid) {
    child.kill(signal)
    return
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
      return
    } catch {
      child.kill(signal)
      return
    }
  }

  try {
    process.kill(-pid, signal)
    return
  } catch {
    child.kill(signal)
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
  options: { cwd: string; signal?: AbortSignal; maxOutputBytes?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number | null; outputTruncated: boolean }> {
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
  })
  if (options.signal?.aborted) throw new Error('command aborted')
  return {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    exitCode,
    outputTruncated
  }
}

export async function collectPaths(root: string, options: { includeDirectories?: boolean; limit: number }): Promise<string[]> {
  const results: string[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && results.length < options.limit) {
    const current = queue.shift()
    if (!current) break
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const next = join(current, entry.name)
      if (entry.isDirectory()) {
        if (options.includeDirectories) results.push(next)
        queue.push(next)
      } else {
        results.push(next)
      }
      if (results.length >= options.limit) break
    }
  }
  return results
}

export async function listDirectory(targetPath: string, root: string, recursive: boolean, limit: number): Promise<ListEntry[]> {
  const targetStat = await stat(targetPath)
  if (!targetStat.isDirectory()) {
    return [makeListEntry(targetPath, root, targetStat)]
  }
  if (!recursive) {
    const entries = await readdir(targetPath, { withFileTypes: true })
    const sliced = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
    const result: ListEntry[] = []
    for (const entry of sliced) {
      const entryPath = join(targetPath, entry.name)
      result.push(makeListEntry(entryPath, root, await stat(entryPath)))
    }
    return result
  }

  const paths = await collectPaths(targetPath, { includeDirectories: true, limit })
  const result: ListEntry[] = []
  for (const filePath of paths) {
    result.push(makeListEntry(filePath, root, await stat(filePath)))
  }
  return result
}

export async function listDirectoryWithOps(
  targetPath: string,
  root: string,
  recursive: boolean,
  limit: number,
  statOp: (path: string) => Promise<FsStats>,
  readdirOp: (path: string) => Promise<Array<{ name: string }>>
): Promise<ListEntry[]> {
  const targetStat = await statOp(targetPath)
  if (!targetStat.isDirectory()) {
    return [makeListEntry(targetPath, root, targetStat)]
  }
  if (!recursive) {
    const entries = await readdirOp(targetPath)
    const sliced = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
    const result: ListEntry[] = []
    for (const entry of sliced) {
      const entryPath = join(targetPath, entry.name)
      result.push(makeListEntry(entryPath, root, await statOp(entryPath)))
    }
    return result
  }
  return listDirectory(targetPath, root, recursive, limit)
}

export function makeListEntry(path: string, root: string, fileStat: FsStats): ListEntry {
  return {
    path,
    relative_path: normalizeToolPath(relative(root, path) || '.'),
    name: basename(path),
    kind: fileStat.isDirectory()
      ? 'directory'
      : fileStat.isFile()
        ? 'file'
        : fileStat.isSymbolicLink()
          ? 'symlink'
          : 'other',
    size: Number(fileStat.size)
  }
}

export function compilePattern(pattern: string, literal: boolean): RegExp {
  if (literal) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'i')
  }
  return new RegExp(pattern, 'i')
}

export function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function globToRegExp(pattern: string): RegExp {
  const optionalPrefix = pattern.startsWith('**/')
  const normalizedPattern = optionalPrefix ? pattern.slice(3) : pattern
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withWildcards = escaped
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/::DOUBLE_STAR::/g, '.*')
  return new RegExp(`^${optionalPrefix ? '(?:.*/)?' : ''}${withWildcards}$`, 'i')
}

export function normalizeToolPath(value: string): string {
  return value.replace(/\\/g, '/').split(sep).join('/')
}

export function parseEditInstructions(args: Record<string, unknown>): EditInstruction[] {
  if (Array.isArray(args.edits)) {
    const edits = args.edits
      .map((value) => {
        if (!value || typeof value !== 'object') return null
        const raw = value as Record<string, unknown>
        return typeof raw.oldText === 'string' && typeof raw.newText === 'string'
          ? { oldText: raw.oldText, newText: raw.newText }
          : null
      })
      .filter((value): value is EditInstruction => value !== null)
    if (edits.length > 0) return edits
  }
  return typeof args.oldText === 'string' && typeof args.newText === 'string'
    ? [{ oldText: args.oldText, newText: args.newText }]
    : []
}

export function findOccurrences(source: string, needle: string): number[] {
  const matches: number[] = []
  if (!needle) return matches
  let index = 0
  while (true) {
    const next = source.indexOf(needle, index)
    if (next === -1) return matches
    matches.push(next)
    index = next + Math.max(1, needle.length)
  }
}

export function applyExactTextEdits(
  source: string,
  edits: EditInstruction[]
): { next: string; replacements: number } {
  const planned = edits.map((edit, index) => {
    const matches = findOccurrences(source, edit.oldText)
    if (matches.length === 0) {
      throw new Error(`edits[${index}].oldText was not found in the target file`)
    }
    if (matches.length > 1) {
      throw new Error(`edits[${index}].oldText matched ${matches.length} locations; each edit must be unique in the original file`)
    }
    return {
      start: matches[0]!,
      end: matches[0]! + edit.oldText.length,
      newText: edit.newText
    }
  })

  const sorted = [...planned].sort((a, b) => a.start - b.start)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (current.start < previous.end) {
      throw new Error('edit ranges overlap in the original file; merge nearby changes into one edit')
    }
  }

  let next = source
  for (const patch of [...sorted].sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, patch.start)}${patch.newText}${next.slice(patch.end)}`
  }
  return { next, replacements: sorted.length }
}
