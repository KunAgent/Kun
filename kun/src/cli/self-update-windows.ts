import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type WindowsGarbageCollectionInput = {
  base: string
  obsoleteReleaseDirs: string[]
  transactionDir: string
  logPath: string
  scriptPath: string
  waitTimeoutMs?: number
}

const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1_000
const WAIT_POLL_SECONDS = 2

function quote(value: string): string {
  return value.replaceAll("'", "''")
}

/**
 * Build the detached garbage-collection script. After the main process has
 * switched the `current` pointer, an old release directory can only be removed
 * once no process still runs from it (Windows locks files in use). The script
 * therefore polls Win32_Process for any executable below each obsolete release
 * directory until none remain or the timeout expires, then removes them. The
 * update result is already durable in the main process before this runs, so a
 * dead updater only leaves stale release directories for the next update to GC.
 */
export function buildWindowsGarbageCollectionScript(input: WindowsGarbageCollectionInput): string {
  const waitTimeoutSeconds = Math.max(
    30,
    Math.ceil((input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS) / 1_000)
  )
  const log = quote(input.logPath)
  const script = quote(input.scriptPath)
  const dirs = input.obsoleteReleaseDirs.map((dir) => quote(dir))
  const dirList = dirs.map((dir) => `'${dir}'`).join(', ')
  return [
    '$ErrorActionPreference = "Continue"',
    `$log = '${log}'`,
    'function Write-UpdateLog([string]$Message) {',
    '  $stamp = (Get-Date).ToUniversalTime().ToString("o")',
    '  Add-Content -LiteralPath $log -Value ($stamp + " " + $Message) -Encoding utf8',
    '}',
    `$dirs = @(${dirList})`,
    'foreach ($dir in $dirs) {',
    '  if (-not (Test-Path -LiteralPath $dir)) { continue }',
    '  $deadline = (Get-Date).AddSeconds(' + String(waitTimeoutSeconds) + ')',
    '  for (;;) {',
    "    $prefix = $dir.TrimEnd('\\\\') + '\\\\'",
    '    $occupants = @(',
    '      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
    '        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }',
    '    )',
    '    if ($occupants.Count -eq 0) { break }',
    '    if ((Get-Date) -ge $deadline) {',
    "      Write-UpdateLog ('still occupied; skipping ' + $dir)",
    '      break',
    '    }',
    '    Start-Sleep -Seconds ' + String(WAIT_POLL_SECONDS),
    '  }',
    '  try {',
    '    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop',
    "    Write-UpdateLog ('removed obsolete release ' + $dir)",
    '  } catch {',
    "    Write-UpdateLog ('could not remove ' + $dir + ': ' + $_.Exception.GetType().Name)",
    '  }',
    '}',
    `Remove-Item -LiteralPath '${script}' -Force -ErrorAction SilentlyContinue`,
    ''
  ].join('\r\n')
}

/**
 * Launch the hidden detached garbage-collection script. This is fire-and-forget:
 * the update result is already written, so a dead updater cannot affect the
 * activated release; it only delays deletion of obsolete release directories.
 */
export async function scheduleWindowsGarbageCollection(
  input: Omit<WindowsGarbageCollectionInput, 'scriptPath'> & { scriptPath?: string }
): Promise<{ pid: number; startedAt: string }> {
  const scriptPath = input.scriptPath ?? join(input.transactionDir, 'gc-release.ps1')
  const script = buildWindowsGarbageCollectionScript({ ...input, scriptPath })
  await writeFile(scriptPath, script, 'utf8')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true }
  )
  child.unref()
  return { pid: child.pid as number, startedAt: new Date().toISOString() }
}
