import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const buildRoot = join(process.cwd(), 'build')
const filesystemPath = join(buildRoot, 'windows-installer-migration-filesystem.ps1')
const pathsPath = join(buildRoot, 'windows-installer-migration-paths.ps1')
const journalPath = join(buildRoot, 'windows-installer-migration-journal.ps1')
const actionsPath = join(buildRoot, 'windows-installer-migration-actions.ps1')
const helperPath = join(buildRoot, 'windows-installer-migration.ps1')
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
const tempRoots: string[] = []

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('Windows installer blocking-process diagnostics', () => {
  it('keeps process details local, structured, and free of command lines', () => {
    const source = [helperPath, pathsPath, filesystemPath]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(source).toContain('function ConvertTo-BlockingProcessDiagnostic')
    expect(source).toContain('processId = [int]$Process.ProcessId')
    expect(source).toContain('parentProcessId = [int]$Process.ParentProcessId')
    expect(source).toContain('name = [string]$Process.Name')
    expect(source).toContain('executablePath = [string]$Process.ExecutablePath')
    expect(source).toContain('ProcessIds = @($remaining')
    expect(source).toContain('Processes = @($remaining')
    expect(source).toContain('ConvertTo-Json -InputObject @($StopResult.Processes)')
    expect(source).not.toMatch(/commandLine|CommandLine/u)
  })
})

windowsOnly('Windows installer diagnostic serialization', () => {
  it('serializes one blocker as a JSON array while preserving ProcessIds', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-process-diagnostic-'))
    tempRoots.push(root)
    const diagnosticPath = join(root, 'installer.log')
    const probePath = join(root, 'probe.ps1')
    writeFileSync(probePath, [
      "$ErrorActionPreference = 'Stop'",
      `. ${psLiteral(pathsPath)}`,
      `. ${psLiteral(filesystemPath)}`,
      `$env:KUN_INSTALLER_DIAGNOSTIC_PATH = ${psLiteral(diagnosticPath)}`,
      "$process = [pscustomobject]@{ ProcessId = 42; ParentProcessId = 7; Name = 'Kun.exe'; ExecutablePath = 'C:\\Program Files\\Kun\\Kun.exe' }",
      '$record = ConvertTo-BlockingProcessDiagnostic $process',
      "$result = @{ Outcome = 'running'; ProcessIds = @(42); Processes = @($record) }",
      'Write-BlockingProcessDiagnostic $result',
      'ConvertTo-Json -InputObject $result -Compress -Depth 4'
    ].join('\r\n'))

    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const result = spawnSync(powershell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath
    ], { encoding: 'utf8' })

    expect(result.status, String(result.stderr)).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      Outcome: 'running',
      ProcessIds: [42],
      Processes: [{
        processId: 42,
        parentProcessId: 7,
        name: 'Kun.exe',
        executablePath: 'C:\\Program Files\\Kun\\Kun.exe'
      }]
    })
    const diagnostic = readFileSync(diagnosticPath, 'utf8')
    expect(diagnostic).toContain('STOP_PROCESSES outcome=running processes=[{')
    expect(diagnostic).not.toMatch(/commandLine|CommandLine/u)
  })

  it('writes the structured blocker before Prepare rejects a running process', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-prepare-diagnostic-'))
    tempRoots.push(root)
    const source = join(root, 'Kun')
    const diagnosticPath = join(root, 'installer.log')
    const recoveryPath = join(root, 'recovery', 'journal.json')
    const probePath = join(root, 'probe.ps1')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(probePath, [
      "$ErrorActionPreference = 'Stop'",
      'Set-StrictMode -Version 2.0',
      `. ${psLiteral(pathsPath)}`,
      `. ${psLiteral(journalPath)}`,
      `. ${psLiteral(filesystemPath)}`,
      `. ${psLiteral(actionsPath)}`,
      `$env:KUN_INSTALLER_SOURCE = ${psLiteral(source)}`,
      "$env:KUN_INSTALLER_SECONDARY_SOURCE = ''",
      `$env:KUN_INSTALLER_TARGET = ${psLiteral(source)}`,
      `$env:KUN_INSTALLER_JOURNAL = ${psLiteral(recoveryPath)}`,
      `$env:KUN_INSTALLER_DIAGNOSTIC_PATH = ${psLiteral(diagnosticPath)}`,
      "$env:KUN_INSTALLER_CANONICAL_LEAF = 'Kun'",
      "$env:KUN_INSTALLER_APP_EXECUTABLE = 'Kun.exe'",
      "$env:KUN_INSTALLER_PRODUCT_NAME = 'Kun'",
      "$env:KUN_INSTALLER_INSTALL_MODE = 'CurrentUser'",
      "$env:KUN_INSTALLER_SELF_PATH = ''",
      'function Stop-AppProcesses {',
      "  $process = [ordered]@{ processId = 42; parentProcessId = 7; name = 'Kun.exe'; executablePath = 'C:\\Program Files\\Kun\\Kun.exe' }",
      "  return @{ Outcome = 'running'; ProcessIds = @(42); Processes = @($process) }",
      '}',
      'try { Invoke-Prepare; throw "Prepare unexpectedly succeeded." }',
      "catch { if ($_.Exception.Message -notmatch 'Unable to stop verified') { throw } }"
    ].join('\r\n'))

    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    )
    const result = spawnSync(powershell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath
    ], { encoding: 'utf8' })

    expect(result.status, String(result.stderr)).toBe(0)
    const diagnostic = readFileSync(diagnosticPath, 'utf8')
    expect(diagnostic).toContain('STOP_PROCESSES outcome=running processes=[{')
    expect(diagnostic).toContain('"parentProcessId":7')
    expect(diagnostic).toContain('"executablePath":"C:\\\\Program Files\\\\Kun\\\\Kun.exe"')
    expect(diagnostic).not.toMatch(/commandLine|CommandLine/u)
  })
})
