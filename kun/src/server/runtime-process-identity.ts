import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { windowsStartupNative, WindowsStartupIntegrityError } from '../process/windows-startup-native.js'

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
const PROCESS_ADMISSION_ATTEMPTS = 2
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
  const result = windowsStartupNative().inspectProcess(pid)
  if (result.state === 'dead') throw Object.assign(new Error('Process exited'), { status: 3 })
  if (result.state !== 'alive' || !result.identity || !Number.isFinite(result.startedAtMs)) return undefined
  return { identity: result.identity, startedAtMs: result.startedAtMs }
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

function inspectRuntimeProcessOrThrow(pid: number): RuntimeProcessInspection {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid PID')
  if (pid === process.pid && cachedCurrentProcessInspection) {
    return cachedCurrentProcessInspection
  }
  let inspection: RuntimeProcessInspection | undefined
  if (process.platform === 'win32') inspection = inspectWindowsProcess(pid)
  else if (process.platform === 'linux') inspection = inspectProcProcess(pid)
  else inspection = inspectPosixProcess(pid)
  if (!inspection?.identity) throw new Error('invalid process identity response')
  if (pid === process.pid) cachedCurrentProcessInspection = inspection
  return inspection
}

export function inspectRuntimeProcess(pid: number): RuntimeProcessInspection | undefined {
  try { return inspectRuntimeProcessOrThrow(pid) } catch { return undefined }
}

/** Admission needs a verified birth identity; errors must not become permission to proceed. */
export function requireRuntimeProcessIdentity(pid = process.pid): string {
  let error: unknown
  // A cold query process under startup load can miss the budget once. Retry
  // only a timeout; not-found and invalid answers are definitive.
  for (let attempt = 1; attempt <= PROCESS_ADMISSION_ATTEMPTS; attempt += 1) {
    try { return inspectRuntimeProcessOrThrow(pid).identity! } catch (caught) {
      if (caught instanceof WindowsStartupIntegrityError) throw caught
      error = caught
      if (errnoCode(caught) !== 'ETIMEDOUT') break
    }
  }
  const code = errnoCode(error)
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status : undefined
  const reason = code === 'ETIMEDOUT'
    ? `process identity query timed out after ${PROCESS_INSPECTION_TIMEOUT_MS}ms (${PROCESS_ADMISSION_ATTEMPTS} attempts)`
    : status === 3 ? 'process was not found by the identity query'
      : code === 'ENOENT' ? 'process identity query executable or process data is unavailable'
        : 'process identity query failed or returned an invalid response'
  // Never copy child stderr, command arguments or environment into diagnostics.
  const state = Number.isSafeInteger(pid) && pid > 0 && processExists(pid)
    ? 'PID still exists or its state is inaccessible' : 'PID is no longer present'
  throw new Error(`Unable to verify owned process ${pid}: ${reason}; ${state}`)
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
