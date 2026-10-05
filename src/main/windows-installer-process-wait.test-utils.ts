import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { encodePowershellCommand } from './one-shot-helper-script'
import { powershellCaptureGuiProcess, powershellWaitForGuiExit } from './update-rollback-readiness'

function powershell(command: string) {
  return spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowershellCommand(command)],
    { encoding: 'utf8', timeout: 15_000 })
}
const quote = (value: string) => value.replace(/'/gu, "''")

/** Force GUI exit exactly between the old existence check and PID-based wait. */
export async function assertGuiExitWaitRace(): Promise<void> {
  const start = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const oldGui = start()
  const stableGui = start()
  try {
    const legacy = powershell([
      "$ErrorActionPreference='Stop'",
      `$waitPid=${oldGui.pid}`,
      '$observed=Get-Process -Id $waitPid',
      '$null=$observed.Handle',
      'Stop-Process -Id $waitPid -Force',
      '$observed.WaitForExit()',
      'Wait-Process -Id $waitPid -Timeout 90 -ErrorAction Stop'
    ].join('; '))
    expect(legacy.status, legacy.stderr).toBe(1)
    expect(legacy.stderr).toContain('NoProcessFoundForGivenId')
    const stable = powershell([
      "$ErrorActionPreference='Stop'",
      `$waitPid=${stableGui.pid}`,
      ...powershellCaptureGuiProcess(),
      'Stop-Process -Id $waitPid -Force',
      '$gui.WaitForExit()',
      powershellWaitForGuiExit(),
      'exit 0'
    ].join('; '))
    expect(stable.status, stable.stderr).toBe(0)
  } finally {
    oldGui.kill()
    stableGui.kill()
  }
}

/** Canonical long path avoids confusing the fixture's 8.3 alias with another process. */
function findRecoveredProcess(executable: string): number | undefined {
  const result = powershell([
    "$ErrorActionPreference='Stop'",
    `$expected='${quote(executable)}'`,
    '$match=Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, $expected, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1',
    'if ($match) { [Console]::Out.Write($match.ProcessId) }'
  ].join('; '))
  expect(result.status, result.stderr).toBe(0)
  const pid = Number(result.stdout.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

export async function waitForRecoveredProcess(executable: string): Promise<number> {
  let pid: number | undefined
  await vi.waitFor(() => {
    pid = findRecoveredProcess(executable)
    expect(pid, `No recovered process started at ${executable}`).toBeDefined()
  }, { timeout: 30_000, interval: 100 })
  return pid!
}

/** Stop only the exact captured fixture process, rechecking its identity before termination. */
export function stopRecoveredProcess(executable: string, knownPid?: number): void {
  const pid = knownPid ?? findRecoveredProcess(executable)
  if (!pid) return
  const expected = quote(executable)
  const result = powershell([
    "$ErrorActionPreference='Stop'",
    `$target=[Diagnostics.Process]::GetProcessById(${pid})`,
    '$null=$target.Handle',
    'try {',
    `  if (-not [string]::Equals($target.MainModule.FileName, '${expected}', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture process identity changed.' }`,
    '  $target.Kill()',
    "  if (-not $target.WaitForExit(5000)) { throw 'Fixture process did not exit.' }",
    '} finally { $target.Dispose() }'
  ].join('\n'))
  expect(result.status, result.stderr).toBe(0)
}
