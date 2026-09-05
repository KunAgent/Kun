import { execFileSync } from 'node:child_process'
import { readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { RUNTIME_DATA_DIR_OWNER_FILE } from '../../kun/src/server/runtime-data-dir-lease.js'

export type ProcessCommand = {
  pid: number
  command: string
  cwd?: string
  environment?: Record<string, string | undefined>
}

export type WindowsProcessCommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding: 'utf8'
    windowsHide: boolean
    timeout: number
    maxBuffer: number
  }
) => string

export const WINDOWS_PROCESS_COMMAND_TIMEOUT_MS = 300_000
export const WINDOWS_PROCESS_COMMAND_SCRIPT =
  `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%serve%'" | ` +
  'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'

const defaultWindowsProcessCommandRunner: WindowsProcessCommandRunner =
  (command, args, options) => execFileSync(command, args, options)

type CommandUseOptions = Pick<ProcessCommand, 'cwd' | 'environment'>

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === 'win32' ? win32 : posix
}

function inferredHomeDir(dataDir: string, platform: NodeJS.Platform): string {
  const api = pathApi(platform)
  const normalized = dataDir.replace(/[\\/]+/g, api.sep)
  const suffixes = [
    api.join('.deepseekgui', 'kun'),
    api.join('.kun', 'data')
  ]
  for (const suffix of suffixes) {
    if (normalized === suffix) continue
    if (normalized.endsWith(`${api.sep}${suffix}`)) {
      return normalized.slice(0, -suffix.length - 1) || api.parse(normalized).root
    }
  }
  return homedir()
}

function expandHomePath(
  raw: string,
  homeDir: string,
  platform: NodeJS.Platform
): string {
  const api = pathApi(platform)
  const trimmed = raw.trim()
  if (trimmed === '~') return homeDir
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return api.join(homeDir, trimmed.slice(2).replace(/[\\/]+/g, api.sep))
  }
  return trimmed.replace(/[\\/]+/g, api.sep)
}

function comparablePath(
  raw: string,
  dataDir: string,
  platform: NodeJS.Platform,
  cwd?: string
): string {
  const api = pathApi(platform)
  const homeDir = inferredHomeDir(dataDir, platform)
  const expanded = expandHomePath(raw, homeDir, platform)
  const resolved = api.resolve(cwd ?? api.parse(dataDir).root, expanded)
  let canonical = resolved
  if (platform === process.platform) {
    try {
      canonical = realpathSync(resolved)
    } catch {
      // A lexical comparison still handles paths that disappeared between
      // process inventory and migration startup.
    }
  }
  const root = api.parse(canonical).root
  const withoutTrailingSeparators = canonical.length > root.length
    ? canonical.replace(/[\\/]+$/, '')
    : canonical
  return platform === 'win32'
    ? withoutTrailingSeparators.toLocaleLowerCase('en-US')
    : withoutTrailingSeparators
}

function pathsReferToSameDirectory(
  candidate: string,
  dataDir: string,
  platform: NodeJS.Platform,
  cwd?: string
): boolean {
  return comparablePath(candidate, dataDir, platform, cwd) ===
    comparablePath(dataDir, dataDir, platform)
}

function commandTokens(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  for (const character of command) {
    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        token += character
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token)
        token = ''
      }
      continue
    }
    token += character
  }
  if (token) tokens.push(token)
  return tokens
}

function optionValue(tokens: readonly string[], names: readonly string[]): string | undefined {
  let selected: string | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    for (const name of names) {
      if (token === name && tokens[index + 1] && !tokens[index + 1].startsWith('--')) {
        selected = tokens[index + 1]
      } else if (token.startsWith(`${name}=`)) {
        selected = token.slice(name.length + 1)
      }
    }
  }
  return selected
}

function environmentValue(
  tokens: readonly string[],
  environment: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  let selected = environment?.[name]
  for (const token of tokens) {
    if (token.startsWith(`${name}=`)) selected = token.slice(name.length + 1)
  }
  return selected
}

function configuredDataDir(
  configPath: string,
  dataDir: string,
  platform: NodeJS.Platform,
  cwd?: string
): string | undefined {
  const api = pathApi(platform)
  const homeDir = inferredHomeDir(dataDir, platform)
  const expanded = expandHomePath(configPath, homeDir, platform)
  const resolved = api.resolve(cwd ?? api.parse(dataDir).root, expanded)
  try {
    const metadata = statSync(resolved)
    if (!metadata.isFile()) {
      throw new Error('config path is not a regular file')
    }
    if (metadata.size > 1024 * 1024) {
      throw new Error('config file exceeds the ownership inspection limit')
    }
    const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('config root is not an object')
    }
    const serve = (parsed as Record<string, unknown>).serve
    if (typeof serve !== 'object' || serve === null || Array.isArray(serve)) return undefined
    const configured = (serve as Record<string, unknown>).dataDir
    return typeof configured === 'string' && configured.trim() ? configured : undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`could not inspect Kun Runtime config ${resolved}: ${message}`, {
      cause: error
    })
  }
}

function commandLooksLikeKunServe(tokens: readonly string[]): boolean {
  if (!tokens.includes('serve')) return false
  return tokens.some((token) => {
    const normalized = token.replace(/\\/g, '/').toLocaleLowerCase('en-US')
    const baseName = normalized.split('/').at(-1)
    return baseName === 'kun' ||
      normalized.includes('/kun.app/') ||
      normalized.includes('serve-entry')
  })
}

export function commandUsesKunDataDir(
  command: string,
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
  options: CommandUseOptions = {}
): boolean {
  const tokens = commandTokens(command)
  const explicitDataDir = optionValue(tokens, ['--data-dir', '--dataDir'])
  if (
    explicitDataDir &&
    pathsReferToSameDirectory(explicitDataDir, dataDir, platform, options.cwd)
  ) {
    return true
  }
  const environmentDataDir = environmentValue(
    tokens,
    options.environment,
    'KUN_DATA_DIR'
  )
  if (
    environmentDataDir &&
    pathsReferToSameDirectory(environmentDataDir, dataDir, platform, options.cwd)
  ) {
    return true
  }
  const configPath =
    optionValue(tokens, ['--config', '--config-file']) ??
    environmentValue(tokens, options.environment, 'KUN_CONFIG')
  const configDataDir = configPath && commandLooksLikeKunServe(tokens)
    ? configuredDataDir(configPath, dataDir, platform, options.cwd)
    : undefined
  return Boolean(
    configDataDir &&
    pathsReferToSameDirectory(configDataDir, dataDir, platform, options.cwd)
  )
}

function linuxProcessMetadata(pid: number): Pick<ProcessCommand, 'cwd' | 'environment'> {
  const environment: Record<string, string> = {}
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf8')
    for (const entry of raw.split('\0')) {
      const separator = entry.indexOf('=')
      if (separator <= 0) continue
      const name = entry.slice(0, separator)
      if (name === 'KUN_DATA_DIR' || name === 'KUN_CONFIG' || name === 'PWD') {
        environment[name] = entry.slice(separator + 1)
      }
    }
  } catch {
    // Permission boundaries are expected for unrelated users. The command
    // line remains usable, while an inventory command failure still blocks.
  }
  let cwd: string | undefined
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    cwd = environment.PWD
  }
  return {
    ...(cwd ? { cwd } : {}),
    ...(Object.keys(environment).length > 0 ? { environment } : {})
  }
}

function darwinCommandWithEnvironment(pid: number, fallback: string): string {
  try {
    return execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 1024 * 1024
    }).trim() || fallback
  } catch {
    return fallback
  }
}

function posixProcessCommands(platform: NodeJS.Platform): ProcessCommand[] {
  const stdout = execFileSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 16 * 1024 * 1024
  })
  const commands: ProcessCommand[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    if (Number.isSafeInteger(pid) && pid > 0) {
      const tokens = commandTokens(match[2])
      const looksLikeKunServe = commandLooksLikeKunServe(tokens)
      commands.push({
        pid,
        command: platform === 'darwin' && looksLikeKunServe
          ? darwinCommandWithEnvironment(pid, match[2])
          : match[2],
        ...(platform === 'linux' && looksLikeKunServe ? linuxProcessMetadata(pid) : {})
      })
    }
  }
  return commands
}

export function windowsProcessCommands(
  run: WindowsProcessCommandRunner = defaultWindowsProcessCommandRunner
): ProcessCommand[] {
  const stdout = run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_PROCESS_COMMAND_SCRIPT
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024
    }
  ).trim()
  if (!stdout) return []
  const parsed = JSON.parse(stdout) as
    | { ProcessId?: unknown; CommandLine?: unknown }
    | Array<{ ProcessId?: unknown; CommandLine?: unknown }>
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row) => {
    const pid = Number(row.ProcessId)
    return Number.isSafeInteger(pid) && pid > 0 && typeof row.CommandLine === 'string'
      ? [{ pid, command: row.CommandLine }]
      : []
  })
}

function activeLeaseOwnerPid(
  dataDir: string,
  processIsAlive: (pid: number) => boolean
): number | undefined {
  const ownerPath = pathApi(process.platform).join(dataDir, RUNTIME_DATA_DIR_OWNER_FILE)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(ownerPath, 'utf8'))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return undefined
    }
    throw new Error(`could not inspect Kun Runtime data directory owner at ${ownerPath}`, {
      cause: error
    })
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    !Number.isSafeInteger((parsed as Record<string, unknown>).pid)
  ) {
    throw new Error(`Kun Runtime data directory owner record is invalid: ${ownerPath}`)
  }
  const pid = Number((parsed as Record<string, unknown>).pid)
  return pid > 0 && processIsAlive(pid) ? pid : undefined
}

function defaultProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
  }
}

export function activeKunRuntimePidsForDataDir(
  dataDir: string,
  options: {
    platform?: NodeJS.Platform
    processCommands?: () => ProcessCommand[]
    processIsAlive?: (pid: number) => boolean
  } = {}
): number[] {
  const platform = options.platform ?? process.platform
  const commands = options.processCommands
    ? options.processCommands()
    : platform === 'win32'
      ? windowsProcessCommands()
      : posixProcessCommands(platform)
  const pids = commands
    .filter(({ pid, command, cwd, environment }) =>
      pid !== process.pid &&
      commandUsesKunDataDir(command, dataDir, platform, { cwd, environment }))
    .map(({ pid }) => pid)
  if (platform === process.platform) {
    const leasePid = activeLeaseOwnerPid(
      dataDir,
      options.processIsAlive ?? defaultProcessIsAlive
    )
    if (leasePid && leasePid !== process.pid) pids.push(leasePid)
  }
  return [...new Set(pids)]
}

export function assertNoActiveKunRuntimeUsingDataDir(
  dataDir: string,
  options: {
    platform?: NodeJS.Platform
    processCommands?: () => ProcessCommand[]
    processIsAlive?: (pid: number) => boolean
  } = {}
): void {
  const pids = activeKunRuntimePidsForDataDir(dataDir, options)
  if (pids.length === 0) return
  throw new Error(
    `an active Kun Runtime still owns the data directory (pid${pids.length === 1 ? '' : 's'} ${pids.join(', ')})`
  )
}
