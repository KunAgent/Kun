import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'

const getPath = vi.fn(() => '/tmp/kun-updater-test-user-data')
const getVersion = vi.fn(() => '0.1.0')

vi.mock('electron', () => ({
  app: { getPath, getVersion }
}))

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'kun-updater-pending-'))
}

describe('gui updater pending state', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
    vi.restoreAllMocks()
  })

  it('only resolves direct Windows backup children inside the recovery root', async () => {
    const pending = await import('./gui-updater-pending')
    const root = 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery'

    expect(pending.resolveBackupDeleteTarget(root, `${root}\\update-backup-123`, win32))
      .toBe(`${root}\\update-backup-123`)
    expect(pending.resolveBackupDeleteTarget(root, 'D:\\KunInstallerRecovery\\update-backup-123', win32)).toBeNull()
    expect(pending.resolveBackupDeleteTarget(root, `${root}\\..\\update-backup-123`, win32)).toBeNull()
    expect(pending.resolveBackupDeleteTarget(root, root, win32)).toBeNull()
    expect(pending.resolveBackupDeleteTarget(root, `${root}\\nested\\update-backup-123`, win32)).toBeNull()
    expect(pending.resolveBackupDeleteTarget(root, `${root}\\update-backup-invalid`, win32)).toBeNull()
  })

  it('does not remove backups outside Windows', async () => {
    const directory = await tempDir()
    directories.push(directory)
    const backup = join(directory, 'update-backup-123')
    await mkdir(backup)
    await writeFile(join(backup, 'keep.txt'), 'keep', 'utf8')
    const pending = await import('./gui-updater-pending')

    await pending.cleanupPendingUpdateBackup(backup)

    await expect(readFile(join(backup, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('persists schema-versioned pending state and consumes an atomic result', async () => {
    const directory = await tempDir()
    directories.push(directory)
    const pending = await import('./gui-updater-pending')

    const written = await pending.writePendingUpdate({
      oldVersion: '0.1.0',
      newVersion: '0.2.0',
      installDir: 'C:\\Program Files\\Kun',
      installerPath: 'C:\\Temp\\Kun-0.2.0.exe',
      installerSha512: 'sha512',
      channel: 'stable'
    }, directory)

    expect(written).toMatchObject({ schemaVersion: 1, state: 'installing', newVersion: '0.2.0' })
    expect(await pending.readPendingUpdate(directory)).toMatchObject({ oldVersion: '0.1.0' })
    await expect(readFile(pending.pendingUpdatePath(directory), 'utf8')).resolves.toContain('Kun-0.2.0.exe')

    const result = await pending.writePendingUpdateResult({
      outcome: 'aborted',
      code: 'payload_invalid',
      phase: 'validate',
      message: 'Payload validation failed.',
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-123',
      transactionState: 'rolled_back',
      rollbackOutcome: 'succeeded'
    }, directory)
    expect(result).toMatchObject({ schemaVersion: 2, transactionState: 'rolled_back' })
    await expect(pending.consumePendingUpdateResult(directory)).resolves.toMatchObject({
      outcome: 'aborted',
      code: 'payload_invalid',
      backupDir: expect.stringContaining('update-backup-123')
    })
    await expect(pending.readPendingUpdateResult(directory)).resolves.toBeNull()
  })

  it('persists recovery separately from the installer handoff', async () => {
    const directory = await tempDir()
    directories.push(directory)
    const pending = await import('./gui-updater-pending')
    await pending.writeGuiUpdateRecovery({
      installedVersion: '0.2.0', channel: 'frontier', verifiedAt: '2026-08-25T00:00:00.000Z',
      healthAttempts: 2, nextHealthCheckAt: '2026-08-25T06:00:00.000Z',
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-123',
      backupExpiresAt: '2026-09-01T00:00:00.000Z', lastError: 'runtime unavailable'
    }, directory)
    await expect(pending.readGuiUpdateRecovery(directory)).resolves.toMatchObject({
      schemaVersion: 2, installedVersion: '0.2.0', healthAttempts: 2
    })
    await expect(pending.readPendingUpdate(directory)).resolves.toBeNull()
    await pending.clearGuiUpdateRecovery(directory)
    await expect(pending.readGuiUpdateRecovery(directory)).resolves.toBeNull()
  })

  it('treats malformed files as absent and restores inherited installer environment', async () => {
    const directory = await tempDir()
    directories.push(directory)
    const pending = await import('./gui-updater-pending')
    await (await import('node:fs/promises')).writeFile(pending.pendingUpdatePath(directory), '{bad json', 'utf8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(pending.readPendingUpdate(directory)).resolves.toBeNull()
    expect(warning).toHaveBeenCalled()

    const environment: NodeJS.ProcessEnv = { KUN_PENDING_UPDATE_PATH: 'old-path' }
    const restore = pending.setPendingUpdateEnvironment(
      'next-path',
      'next-result',
      '0.1.0',
      '0.2.0',
      environment,
      'win32'
    )
    expect(environment).toMatchObject({
      KUN_PENDING_UPDATE_PATH: 'next-path',
      KUN_PENDING_UPDATE_RESULT: 'next-result',
      KUN_INSTALLER_OLD_VERSION: '0.1.0',
      KUN_INSTALLER_NEW_VERSION: '0.2.0'
    })
    restore()
    expect(environment).toEqual({ KUN_PENDING_UPDATE_PATH: 'old-path' })
  })
})
