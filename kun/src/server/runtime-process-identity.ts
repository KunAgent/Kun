import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type RuntimeProcessRecordIdentity = {
  startedAt: string
  processIdentity?: string
}

export type RuntimeProcessIsAlive = (
  pid: number,
  record?: RuntimeProcessRecordIdentity
) => boolean

export type RuntimeProcessInspection = {
  identity?: string
  startedAtMs?: number
}

export function isValidRuntimeProcessIdentity(value: unknown): value is string | undefined {
  return value === undefined || (
    typeof value === 'string' && value.length > 0 && value.length <= 512
  )
}

const PROCESS_INSPECTION_TIMEOUT_MS = 3_000
const PROCESS_INSPECTION_MAX_BUFFER = 16 * 1024
let cachedCurrentProcessInspection: RuntimeProcessInspection | undefined

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but cannot be signalled. Unknown errors
    // also fail closed instead of reclaiming a potentially live owner.
    return errnoCode(error) !== 'ESRCH'
  }
}

function boundedExec(executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    timeout: PROCESS_INSPECTION_TIMEOUT_MS,
    maxBuffer: PROCESS_INSPECTION_MAX_BUFFER,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
  }).trim()
}

function inspectWindowsProcess(pid: number): RuntimeProcessInspection | undefined {
  const systemRoot = process.env.SystemRoot?.trim()
  const powershell = systemRoot
    ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const command = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop`,
    'if ($null -eq $p) { exit 3 }',
    `[Console]::Out.Write($p.CreationDate.ToUniversalTime().ToString('O'))`
  ].join('; ')
  const startedAt = boundedExec(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command
  ])
  const startedAtMs = Date.parse(startedAt)
  if (!startedAt || !Number.isFinite(startedAtMs)) return undefined
  return { identity: `win32-v1:${startedAt}`, startedAtMs }
}

function inspectProcProcess(pid: number): RuntimeProcessInspection | undefined {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const commandEnd = stat.lastIndexOf(')')
  if (commandEnd < 0) return undefined
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u)
  const startTicks = fields[19]
  if (!startTicks || !/^\d+$/u.test(startTicks)) return undefined
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  if (!bootId) return undefined
  let startedAtMs: number | undefined
  try {
    startedAtMs = inspectPosixStartedAt(pid)
  } catch {
    // The opaque boot/tick identity is still authoritative for new records.
  }
  return {
    identity: `linux-v1:${bootId}:${startTicks}`,
    ...(startedAtMs === undefined ? {} : { startedAtMs })
  }
}

function inspectPosixStartedAt(pid: number): number | undefined {
  const value = boundedExec('/bin/ps', ['-o', 'lstart=', '-p', String(pid)])
  const startedAtMs = Date.parse(value)
  return Number.isFinite(startedAtMs) ? startedAtMs : undefined
}

function inspectPosixProcess(pid: number): RuntimeProcessInspection | undefined {
  const startedAt = boundedExec('/bin/ps', ['-o', 'lstart=', '-p', String(pid)])
  const startedAtMs = Date.parse(startedAt)
  if (!startedAt || !Number.isFinite(startedAtMs)) return undefined
  return { identity: `${process.platform}-v1:${startedAt}`, startedAtMs }
}

export function inspectRuntimeProcess(pid: number): RuntimeProcessInspection | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  if (pid === process.pid && cachedCurrentProcessInspection) {
    return cachedCurrentProcessInspection
  }
  let inspection: RuntimeProcessInspection | undefined
  try {
    if (process.platform === 'win32') inspection = inspectWindowsProcess(pid)
    else if (process.platform === 'linux') inspection = inspectProcProcess(pid)
    else inspection = inspectPosixProcess(pid)
  } catch {
    inspection = undefined
  }
  if (pid === process.pid && inspection) cachedCurrentProcessInspection = inspection
  return inspection
}

export function runtimeProcessIdentity(pid = process.pid): string | undefined {
  return inspectRuntimeProcess(pid)?.identity
}

export function runtimeProcessInspectionMatchesRecord(
  record: RuntimeProcessRecordIdentity | undefined,
  inspection: RuntimeProcessInspection | undefined
): boolean {
  if (!record || !inspection) return true
  if (record.processIdentity) {
    return inspection.identity === undefined || inspection.identity === record.processIdentity
  }
  const recordedAtMs = Date.parse(record.startedAt)
  if (!Number.isFinite(recordedAtMs) || inspection.startedAtMs === undefined) return true
  // A process that started after the record was written cannot be its owner.
  return inspection.startedAtMs <= recordedAtMs
}

export const runtimeProcessIsAlive: RuntimeProcessIsAlive = (pid, record) => {
  if (!processExists(pid)) return false
  const inspection = inspectRuntimeProcess(pid)
  if (!inspection) return processExists(pid)
  return runtimeProcessInspectionMatchesRecord(record, inspection)
}
