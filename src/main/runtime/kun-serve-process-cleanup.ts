import { basename } from 'node:path'
import { appendManagedLogLine } from '../logger'
import { terminateVerifiedPid, waitForPidExit } from '../kun-process-ports'
import { execFileAsync, formatKunLogLine } from '../kun-process-state'

export type KunServeProcessSnapshot = {
  pid: number
  parentPid: number
  command: string
  executable?: string
}

export type KunServeCleanupReport = {
  matchedPids: number[]
  terminatedPids: number[]
  alreadyExitedPids: number[]
  failedPids: number[]
}

type ProcessTableRunner = (
  command: string,
  args: string[],
  options: {
    windowsHide: boolean
    timeout: number
    maxBuffer: number
  }
) => Promise<{ stdout: string }>

type ProcessListOptions = {
  platform?: NodeJS.Platform
  currentUid?: number
  run?: ProcessTableRunner
}

type CleanupOptions = {
  currentPid?: number
  listProcesses?: () => Promise<KunServeProcessSnapshot[]>
  inspectProcess?: (pid: number) => Promise<KunServeProcessSnapshot | null>
  terminate?: typeof terminateVerifiedPid
  waitForExit?: typeof waitForPidExit
  log?: (line: string) => Promise<void>
}

export const PROCESS_TABLE_TIMEOUT_MS = 30 * 60_000
const PROCESS_TABLE_MAX_BUFFER = 16 * 1024 * 1024

export const WINDOWS_PROCESS_CANDIDATE_SCRIPT = [
  "$candidates = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe' OR Name = 'electron.exe' OR Name LIKE 'kun%.exe'\"",
  '$items = $candidates | ForEach-Object {',
  '  [pscustomobject]@{',
  '    ProcessId = $_.ProcessId',
  '    ParentProcessId = $_.ParentProcessId',
  '    ExecutablePath = $_.ExecutablePath',
  '    CommandLine = $_.CommandLine',
  '  }',
  '}',
  '@($items) | ConvertTo-Json -Compress'
].join('\n')

export function windowsCurrentUserProcessScript(pid: number): string {
  if (!validPid(pid)) throw new Error(`Invalid process ID: ${pid}`)
  return [
    '$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    `$candidate = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    '$items = @()',
    'if ($null -ne $candidate) {',
    '  $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid -ErrorAction SilentlyContinue',
    '  if ($owner.Sid -eq $currentSid) {',
    '    $items += [pscustomobject]@{',
    '      ProcessId = $candidate.ProcessId',
    '      ParentProcessId = $candidate.ParentProcessId',
    '      ExecutablePath = $candidate.ExecutablePath',
    '      CommandLine = $candidate.CommandLine',
    '    }',
    '  }',
    '}',
    '@($items) | ConvertTo-Json -Compress'
  ].join('\n')
}

const defaultRun: ProcessTableRunner = async (command, args, options) => {
  const result = await execFileAsync(command, args, options)
  return { stdout: String(result.stdout ?? '') }
}

export async function listCurrentUserProcesses(
  options: ProcessListOptions = {}
): Promise<KunServeProcessSnapshot[]> {
  const platform = options.platform ?? process.platform
  const run = options.run ?? defaultRun
  if (platform === 'win32') {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_CANDIDATE_SCRIPT],
      processTableCommandOptions()
    )
    const candidates = parseWindowsProcessSnapshot(stdout)
      .filter((entry) => looksLikeKunServeProcess(entry))
    const verified: KunServeProcessSnapshot[] = []
    for (const candidate of candidates) {
      const current = await inspectCurrentUserProcess(candidate.pid, { platform, run })
      if (current && looksLikeKunServeProcess(current)) verified.push(current)
    }
    return verified
  }

  const currentUid = options.currentUid ?? process.getuid?.()
  if (!Number.isInteger(currentUid) || (currentUid ?? -1) < 0) {
    throw new Error('Cannot verify the current Unix user while scanning Kun serve processes.')
  }
  const { stdout } = await run(
    'ps',
    ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'uid=', '-o', 'command='],
    processTableCommandOptions()
  )
  return parseUnixProcessSnapshot(stdout, currentUid as number)
}

export async function inspectCurrentUserProcess(
  pid: number,
  options: ProcessListOptions = {}
): Promise<KunServeProcessSnapshot | null> {
  if (!validPid(pid)) return null
  const platform = options.platform ?? process.platform
  const run = options.run ?? defaultRun
  if (platform === 'win32') {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', windowsCurrentUserProcessScript(pid)],
      processTableCommandOptions()
    )
    return parseWindowsProcessSnapshot(stdout).find((entry) => entry.pid === pid) ?? null
  }

  const currentUid = options.currentUid ?? process.getuid?.()
  if (!Number.isInteger(currentUid) || (currentUid ?? -1) < 0) {
    throw new Error('Cannot verify the current Unix user while inspecting a Kun serve process.')
  }
  const { stdout } = await run(
    'ps',
    ['-p', String(pid), '-o', 'pid=', '-o', 'ppid=', '-o', 'uid=', '-o', 'command='],
    processTableCommandOptions()
  )
  return parseUnixProcessSnapshot(stdout, currentUid as number)
    .find((entry) => entry.pid === pid) ?? null
}

function processTableCommandOptions(): {
  windowsHide: boolean
  timeout: number
  maxBuffer: number
} {
  return {
    windowsHide: true,
    timeout: PROCESS_TABLE_TIMEOUT_MS,
    maxBuffer: PROCESS_TABLE_MAX_BUFFER
  }
}

export function parseUnixProcessSnapshot(
  stdout: string,
  currentUid: number
): KunServeProcessSnapshot[] {
  const processes: KunServeProcessSnapshot[] = []
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const match = rawLine.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/u)
    if (!match) continue
    const pid = Number(match[1])
    const parentPid = Number(match[2])
    const uid = Number(match[3])
    const command = match[4]?.trim() ?? ''
    if (!validPid(pid) || !validParentPid(parentPid) || uid !== currentUid || !command) continue
    processes.push({ pid, parentPid, command })
  }
  return processes
}

export function parseWindowsProcessSnapshot(stdout: string): KunServeProcessSnapshot[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new Error(`Windows process scan returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const processes: KunServeProcessSnapshot[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    const pid = Number(record.ProcessId)
    const parentPid = Number(record.ParentProcessId)
    const command = typeof record.CommandLine === 'string' ? record.CommandLine.trim() : ''
    const executable = typeof record.ExecutablePath === 'string'
      ? record.ExecutablePath.trim()
      : ''
    if (!validPid(pid) || !validParentPid(parentPid) || !command) continue
    processes.push({
      pid,
      parentPid,
      command,
      ...(executable ? { executable } : {})
    })
  }
  return processes
}

export function looksLikeKunServeProcess(
  snapshot: KunServeProcessSnapshot,
  currentPid = process.pid
): boolean {
  if (snapshot.pid === currentPid) return false
  return looksLikeKunServeCommand(snapshot.command, snapshot.executable)
}

export function looksLikeKunServeCommand(command: string, executable = ''): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  const normalizedTitle = trimmed.toLowerCase()
  if (normalizedTitle === 'kun-runtime' || normalizedTitle === 'kun-dv-runtime') return true
  if (normalizedTitle === 'kun-service-manager') return false

  const tokens = splitCommandLine(trimmed)
  if (tokens.length < 2) return false
  const executableName = normalizedExecutableName(executable || tokens[0] || '')
  if (!isAllowedKunServeExecutable(executableName)) return false

  const serveIndex = tokens.findIndex((token, index) => index > 0 && token.toLowerCase() === 'serve')
  if (serveIndex < 1) return false
  const hasServeEntry = tokens.slice(1, serveIndex).some((token) => isKunServeEntry(token))
  return hasServeEntry || (isStandaloneKunExecutable(executableName) && serveIndex === 1)
}

export async function clearHistoricalKunServeProcesses(
  options: CleanupOptions = {}
): Promise<KunServeCleanupReport> {
  const currentPid = options.currentPid ?? process.pid
  const listProcesses = options.listProcesses ?? (() => listCurrentUserProcesses())
  const inspectProcess = options.inspectProcess ?? (options.listProcesses
    ? async (pid: number) => (await listProcesses()).find((entry) => entry.pid === pid) ?? null
    : (pid: number) => inspectCurrentUserProcess(pid))
  const terminate = options.terminate ?? terminateVerifiedPid
  const waitForExit = options.waitForExit ?? waitForPidExit
  const log = options.log ?? ((line) => appendManagedLogLine('kun', line))
  const initial = await listProcesses()
  const matches = initial.filter((entry) => looksLikeKunServeProcess(entry, currentPid))
  const report: KunServeCleanupReport = {
    matchedPids: matches.map((entry) => entry.pid),
    terminatedPids: [],
    alreadyExitedPids: [],
    failedPids: []
  }

  await log(formatKunLogLine(
    'lifecycle',
    undefined,
    `explicit restart scan found ${matches.length} historical kun serve process(es)`
  ))

  for (const match of matches) {
    const exitedBeforeSignal = await waitForExit(match.pid, 0)
    if (exitedBeforeSignal) {
      report.alreadyExitedPids.push(match.pid)
      continue
    }
    await log(formatKunLogLine('lifecycle', match.pid, 'terminating historical kun serve process'))
    const terminated = await terminate(match.pid, async () => {
      const current = await inspectProcess(match.pid)
      return Boolean(current && looksLikeKunServeProcess(current, currentPid))
    }, waitForExit)
    if (terminated) {
      report.terminatedPids.push(match.pid)
      continue
    }
    if (await waitForExit(match.pid, 0)) {
      report.alreadyExitedPids.push(match.pid)
      continue
    }
    report.failedPids.push(match.pid)
    await log(formatKunLogLine('lifecycle', match.pid, 'failed to terminate historical kun serve process'))
  }

  if (report.failedPids.length > 0) {
    throw new Error(
      `Could not terminate historical Kun serve process(es): ${report.failedPids.join(', ')}. A replacement was not started.`
    )
  }
  return report
}

function splitCommandLine(command: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/gu
  for (const match of command.matchAll(pattern)) {
    const token = match[1] ?? match[2] ?? match[3]
    if (token) tokens.push(token)
  }
  return tokens
}

function normalizedExecutableName(value: string): string {
  return basename(value.replace(/\\/gu, '/')).toLowerCase()
}

function isAllowedKunServeExecutable(name: string): boolean {
  return isStandaloneKunExecutable(name) ||
    name === 'node' || name === 'node.exe' ||
    name === 'electron' || name === 'electron.exe'
}

function isStandaloneKunExecutable(name: string): boolean {
  return /^kun(?:[-_.][a-z0-9-]+)?(?:\.exe)?$/u.test(name)
}

function isKunServeEntry(token: string): boolean {
  return /(?:^|[/\\])serve(?:-entry)?\.(?:cjs|mjs|js)$/iu.test(token)
}

function validPid(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function validParentPid(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}
