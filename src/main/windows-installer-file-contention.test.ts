import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const recovery = resolve('build/windows-installer-migration-recovery-env.ps1')
const payload = resolve('build/windows-installer-migration-payload-copy.ps1')
const transaction = readFileSync(resolve('build/windows-installer-migration-transaction.ps1'), 'utf8')
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function run(script: string) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    // -Command otherwise inherits $? from an intentionally caught contention error.
    `$ErrorActionPreference='Stop'; Set-StrictMode -Version 2;
      try { ${script}; exit 0 } catch { [Console]::Error.WriteLine($_); exit 1 }`], { encoding: 'utf8', timeout: 60_000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return result.stdout + result.stderr
}

describe('update cutover contention wiring', () => {
  it('rechecks processes immediately before the first switch mutation and before rollback', () => {
    const switching = transaction.split('function Invoke-SwitchUpdatePayload')[1].split('function Assert-PackagedInstallPayloadAt')[0]
    expect(switching.indexOf('Stop-UpdatePayloadProcesses')).toBeLessThan(switching.indexOf('Remove-PayloadTreeIfPresent'))
    expect(switching).toContain('Invoke-UpdateFileOperation { Move-Item -LiteralPath $target')
    const rollback = transaction.split('function Invoke-RollbackUpdateTransaction')[1].split('function Resolve-UpdateHealthToken')[0]
    expect(rollback.indexOf('Stop-UpdatePayloadProcesses')).toBeLessThan(rollback.indexOf('Remove-PayloadTreeIfPresent'))
    expect(rollback).toContain('Invoke-UpdateFileOperation { Move-Item -LiteralPath $old')
  })
  it.each(['\n', '\r\n'])('publishes installer birth identity before prepared metadata with %j line endings', newline => {
    const sourceWithLineEndings = transaction.replace(/\r?\n/g, newline)
    expect(sourceWithLineEndings).toMatch(/Set-InstallerTransactionOwner \$transaction\r?\n {2}Write-UpdateTransaction \$transaction/)
    const source = readFileSync(payload, 'utf8')
    expect(source).toContain('error != 32 && error != 33')
    expect(source).toContain('retryWaitMs >= 10000')
  })
})

describe.skipIf(process.platform !== 'win32')('native update contention regression', () => {
  it('reports completed assertions independently of caught errors without hiding failed assertions', () => {
    expect(() => run("try { throw 'expected fixture error' } catch {}; if($false){throw 'unreachable'}")).not.toThrow()
    expect(() => run("throw 'fixture assertion failure'")).toThrow(/fixture assertion failure/)
  })
  it('retries transient lock errors but not access denial and caps persistent contention', () => {
    run(`. ${quote(recovery)};
      function Write-InstallerDiagnostic($text) { [Console]::WriteLine($text) }
      function Start-Sleep { param($Milliseconds) }
      $script:UpdateFileWaitMs=0; $script:attempts=0;
      Invoke-UpdateFileOperation { $script:attempts++; if($script:attempts -lt 3){throw [ComponentModel.Win32Exception]::new(32)} };
      if($script:attempts -ne 3){throw 'transient not retried'};
      $script:UpdateFileWaitMs=0; $script:attempts=0;
      $denied=$false;
      try { Invoke-UpdateFileOperation { $script:attempts++; throw [ComponentModel.Win32Exception]::new(5) } }
      catch { $denied=$true };
      if(-not $denied -or $script:attempts -ne 1 -or $script:UpdateFileWaitMs -ne 0){throw 'denial not preserved'};
      $script:UpdateFileWaitMs=0; $script:attempts=0; $contended=$false;
      try { Invoke-UpdateFileOperation { $script:attempts++; throw [ComponentModel.Win32Exception]::new(33) } }
      catch { $contended=$true };
      if(-not $contended -or $script:attempts -ne 14 -or $script:UpdateFileWaitMs -ne 10000){throw 'unbounded contention'};`)
  })
  it('copies the original bytes after a real transient destination lock releases', () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-copy-contention-'))
    try {
      const output = run(`. ${quote(payload)};
        Add-Type -TypeDefinition 'using System; using System.IO; using System.Threading; public static class KunCopyLockFixture {
          public static void Lock(string path) { var s=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.None);
          var t=new Thread(delegate(){Thread.Sleep(1500);s.Dispose();});t.Start(); }
        }';
        $source=Join-Path ${quote(root)} source; $target=Join-Path ${quote(root)} target;
        [IO.Directory]::CreateDirectory($source)|Out-Null; [IO.Directory]::CreateDirectory($target)|Out-Null;
        [IO.File]::WriteAllText((Join-Path $source payload),'original'); [IO.File]::WriteAllText((Join-Path $target payload),'old');
        [KunCopyLockFixture]::Lock((Join-Path $target payload));
        [KunInstallerPayloadCopy]::Copy($source,$target,$false);
        if([IO.File]::ReadAllText((Join-Path $target payload)) -ne 'original'){throw 'lost bytes'};`)
      expect(output).toContain('FILE_BUSY')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
