import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn()
}))

import { spawn } from 'node:child_process'
import {
  buildWindowsGarbageCollectionScript,
  scheduleWindowsGarbageCollection,
  type WindowsGarbageCollectionInput
} from './self-update-windows.js'

function input(overrides: Partial<WindowsGarbageCollectionInput> = {}): WindowsGarbageCollectionInput {
  return {
    base: 'C:\\Users\\me\\AppData\\Local\\KunTui\\kun',
    obsoleteReleaseDirs: [
      'C:\\Users\\me\\AppData\\Local\\KunTui\\kun\\releases\\aaaa',
      'C:\\Users\\me\\AppData\\Local\\KunTui\\kun\\releases\\bbbb'
    ],
    transactionDir: 'C:\\Users\\me\\AppData\\Local\\KunTui\\.kun.kun-tui-update',
    logPath: 'C:\\Users\\me\\AppData\\Local\\KunTui\\.kun.kun-tui-update\\update.log',
    scriptPath: 'C:\\Users\\me\\AppData\\Local\\KunTui\\.kun.kun-tui-update\\gc-release.ps1',
    ...overrides
  }
}

describe('Windows garbage collection script', () => {
  it('waits on every process below each obsolete release directory', () => {
    const script = buildWindowsGarbageCollectionScript(input())
    expect(script).toContain('Get-CimInstance Win32_Process')
    expect(script).toContain('StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)')
    expect(script).toContain("$prefix = $dir.TrimEnd('\\\\') + '\\\\'")
    expect(script).toContain('Start-Sleep -Seconds 2')
    expect(script).toContain('AddSeconds(600)')
  })

  it('honors a custom wait timeout', () => {
    const script = buildWindowsGarbageCollectionScript(input({ waitTimeoutMs: 45_000 }))
    expect(script).toContain('AddSeconds(45)')
  })

  it('removes each obsolete release directory and logs the outcome', () => {
    const script = buildWindowsGarbageCollectionScript(input())
    expect(script).toContain('Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop')
    expect(script).toContain("Write-UpdateLog ('removed obsolete release ' + $dir)")
    expect(script).toContain("Write-UpdateLog ('could not remove ' + $dir + ': ' + $_.Exception.GetType().Name)")
    expect(script).toContain('foreach ($dir in $dirs)')
    expect(script).toContain('$dirs = @(')
  })

  it('uses CRLF line endings', () => {
    const script = buildWindowsGarbageCollectionScript(input())
    expect(script).toContain('\r\n')
    expect(script.replaceAll('\r\n', '')).not.toContain('\r')
    expect(script.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('escapes single quotes in every interpolated path', () => {
    const quoted = buildWindowsGarbageCollectionScript(input({
      logPath: "C:\\Install's\\update.log",
      obsoleteReleaseDirs: ["C:\\Install's\\kun\\releases\\aaaa"]
    }))
    expect(quoted).toContain("$log = 'C:\\Install''s\\update.log'")
    expect(quoted).toContain("'C:\\Install''s\\kun\\releases\\aaaa'")
  })

  it('removes its own script on completion', () => {
    const script = buildWindowsGarbageCollectionScript(input())
    expect(script).toContain('gc-release.ps1')
    expect(script).toContain('Remove-Item -LiteralPath')
  })
})

describe('Windows garbage collection scheduling', () => {
  it('writes the script and spawns a detached hidden PowerShell process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-win-gc-test-'))
    try {
      const transactionDir = join(dir, 'txn')
      await mkdir(transactionDir, { recursive: true })
      const child = {
        pid: 4242,
        unref: () => undefined
      }
      vi.mocked(spawn).mockReturnValue(child as never)
      const result = await scheduleWindowsGarbageCollection({
        base: join(dir, 'kun'),
        obsoleteReleaseDirs: [join(dir, 'kun', 'releases', 'aaaa')],
        transactionDir,
        logPath: join(transactionDir, 'update.log')
      })
      expect(result.pid).toBe(4242)
      expect(typeof result.startedAt).toBe('string')
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(transactionDir, 'gc-release.ps1')],
        expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true })
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
