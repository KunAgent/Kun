import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve('build', file), 'utf8').replace(/\r\n/g, '\n')
const lease = read('installer-pending-lease.nsh')
const installer = read('installer.nsh')
const automatic = read('installer-automatic-update.nsh')

describe('pending metadata lease integration (static contracts)', () => {
  it('acquires before Prepare, using existing read-only, non-inheritable handle', () => {
    const prepare = installer.slice(installer.indexOf('  Function KunPrepareInstallMigration'))
    expect(prepare.indexOf('Call KunAcquirePendingLease')).toBeLessThan(prepare.indexOf('kunRunMigrationHelper Prepare'))
    expect(lease).toContain('CreateFileW(w R9, i 0x80000000, i 1, p 0, i 3, i 0x00200000, p 0)p.R8')
    expect(lease).toContain("GetFileType(p R8)i.R9'\n    ${if} $R9 != 1")
    const acquire = lease.slice(lease.indexOf('  Function KunAcquirePendingLease'))
    expect(acquire.match(/kunRunMigrationHelper ValidatePendingLease/g)).toHaveLength(2)
    expect(acquire.indexOf('ValidatePendingLease')).toBeLessThan(acquire.indexOf('CreateFileW'))
    expect(acquire.lastIndexOf('ValidatePendingLease')).toBeGreaterThan(acquire.indexOf('CreateFileW'))
  })

  it('publishes result then releases before rollback relaunch, without permanent mutations', () => {
    expect(automatic).toContain('Call KunRestoreAutomaticUpdateBackup\n    Call KunWriteAutomaticUpdateResult\n    Call KunTryRelaunchOldApp')
    expect(automatic).toContain('Call KunRestoreAutomaticUpdateBackup\n      Call KunWriteAutomaticUpdateResult\n      Call KunTryRelaunchOldApp')
    expect(automatic).toContain('kunRunMigrationHelper WriteUpdateResult\n    Call KunReleasePendingLease')
    expect(lease).toContain("kernel32::CloseHandle(p $KunInstallerPendingLease)")
    expect(lease).not.toMatch(/Delete |SetFileAttributes|Exec /)
    const abort = lease.slice(lease.indexOf('!macro KunAbortPendingLease'), lease.indexOf('!macro KunPendingLeaseFunctions'))
    expect(abort).toContain('Call KunReleasePendingLease\n  DetailPrint "${MESSAGE}"\n  Call KunTryRelaunchOldApp')
    expect(abort.indexOf('Call KunTryRelaunchOldApp')).toBeLessThan(abort.indexOf('Quit'))
    expect(abort).not.toContain('KunWriteAutomaticUpdateResult')
    expect(abort).not.toContain('KunRestoreAutomaticUpdateBackup')
    // System plugin r0..r9 are $0..$9, uppercase R0..R9 are $R0..$R9.
    expect(lease).not.toMatch(/(?:[ .(])r[0-9]\b/)
    expect(lease).toContain('CloseHandle(p $KunInstallerPendingLease)i.R0')
    expect(lease).not.toContain('${isUpdated}') // generated predicate clobbers R9
  })
})

const windows = process.platform === 'win32' ? describe : describe.skip
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kun-pending-lease-')); roots.push(root)
  const pendingPath = join(root, 'pending-update.json')
  const executable = join(root, 'verified-installer.exe')
  writeFileSync(executable, 'owned native lease test fixture')
  const pending = { schemaVersion: 1, state: 'installing', oldVersion: '0.4.3', newVersion: '0.4.4',
    installDir: join(root, 'Kun'), installerPath: executable,
    installerSha512: createHash('sha512').update(readFileSync(executable)).digest('base64') }
  writeFileSync(pendingPath, JSON.stringify(pending))
  const env = { ...process.env, KUN_PENDING_UPDATE_PATH: pendingPath,
    KUN_PENDING_UPDATE_RESULT: join(root, 'pending-update-result.json'),
    KUN_INSTALLER_SOURCE: pending.installDir, KUN_INSTALLER_OLD_VERSION: '0.4.3',
    KUN_INSTALLER_NEW_VERSION: '0.4.4', KUN_INSTALLER_PENDING_VERSION: '0.4.4',
    KUN_INSTALLER_PENDING_EXECUTABLE: executable }
  return { root, pendingPath, pending, env }
}
function validate(input: ReturnType<typeof fixture>) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('build/windows-installer-migration.ps1'), '-Action', 'ValidatePendingLease'],
  { env: input.env, encoding: 'utf8', timeout: 30_000 })
}

windows('pending metadata lease native behavior', () => {
  it('authenticates owned source, versions and exact installer bytes; rejects mismatches and missing records', () => {
    const input = fixture()
    expect(validate(input).status).toBe(0)
    for (const patch of [{ oldVersion: '9.0.0' }, { installDir: join(input.root, 'other') },
      { installerSha512: 'untrusted' }, { state: 'finished' }]) {
      writeFileSync(input.pendingPath, JSON.stringify({ ...input.pending, ...patch }))
      expect(validate(input).status).not.toBe(0)
    }
    writeFileSync(input.pendingPath, '{invalid secret-marker')
    const malformed = validate(input)
    expect(malformed.status).not.toBe(0)
    expect(malformed.stdout + malformed.stderr).not.toContain('secret-marker')
    rmSync(input.pendingPath)
    expect(validate(input).status).not.toBe(0)
  }, 60_000)

  it('rejects a mismatched result profile and reparse-point parent without altering metadata', () => {
    const input = fixture()
    const original = readFileSync(input.pendingPath)
    input.env.KUN_PENDING_UPDATE_RESULT = join(input.root, 'elsewhere', 'pending-update-result.json')
    expect(validate(input).status).not.toBe(0)
    const alias = join(input.root, 'alias')
    symlinkSync(input.root, alias, 'junction')
    input.env.KUN_PENDING_UPDATE_PATH = join(alias, 'pending-update.json')
    input.env.KUN_PENDING_UPDATE_RESULT = join(alias, 'pending-update-result.json')
    expect(validate(input).status).not.toBe(0)
    expect(readFileSync(input.pendingPath)).toEqual(original)
    rmSync(alias)
  }, 30_000)

  it.each(['normal', 'terminated'])('denies writes/delete but allows reads until owner %s exit', async (exitMode) => {
    const input = fixture()
    const original = readFileSync(input.pendingPath)
    const ready = join(input.root, 'ready')
    // Same access/share/disposition contract as the NSIS CreateFile call.
    const command = `$h=[IO.File]::Open(${quote(input.pendingPath)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); ` +
      `[IO.File]::WriteAllText(${quote(ready)},'ready'); [Console]::ReadLine() | Out-Null; $h.Dispose()`
    const owner = spawn('powershell.exe', ['-NoProfile', '-Command', command], { stdio: ['pipe', 'ignore', 'pipe'] })
    const done = new Promise<number | null>((resolveExit, reject) => { owner.once('exit', resolveExit); owner.once('error', reject) })
    try {
      const deadline = Date.now() + 15_000
      while (!existsSync(ready) && Date.now() < deadline && owner.exitCode === null) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
      expect(existsSync(ready)).toBe(true)
      expect(readFileSync(input.pendingPath)).toEqual(original)
      expect(() => rmSync(input.pendingPath, { force: true })).toThrow()
      expect(() => writeFileSync(input.pendingPath, 'overwrite')).toThrow()
      expect(readFileSync(input.pendingPath)).toEqual(original)
      expect(validate(input).status).toBe(0) // validation remains readable under lease
      if (exitMode === 'normal') {
        owner.stdin.end('\n')
        expect(await done).toBe(0)
      } else {
        owner.kill()
        await done
      }
      rmSync(input.pendingPath)
      expect(existsSync(input.pendingPath)).toBe(false)
    } finally { if (owner.exitCode === null) { owner.kill(); await done } }
  }, 30_000)
})
