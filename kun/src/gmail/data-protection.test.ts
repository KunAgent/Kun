import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EncryptedGmailStorageGuard, locateStorage } from './data-protection.js'

const cleanups: string[] = []
afterEach(async () => { for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true }) })
const report = { FileVault: true, Encryption: true, EncryptionThisVolumeProper: true }
function fixture(platform: NodeJS.Platform = 'darwin') {
  let now = 1_000
  const location = { path: '/resolved/profile', filesystemId: 'device-1' }
  const locate = vi.fn(async () => location)
  const run = vi.fn(async (command: string, _args: readonly string[], _input?: string) => {
    if (command === '/bin/df') return 'Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 100 20 80 20% /System/Volumes/Data\n'
    if (command === '/usr/sbin/diskutil') return '<plist><dict>verified OS report</dict></plist>'
    return JSON.stringify(report)
  })
  const guard = new EncryptedGmailStorageGuard({ platform, locate, run, now: () => now })
  return { guard, run, locate, location, advance: () => { now += 11_000 } }
}

describe('Gmail app-managed data encryption eligibility', () => {
  it('checks the exact resolved profile volume and requires all encryption flags', async () => {
    const f = fixture()
    await expect(f.guard.assert('/input/profile')).resolves.toBeUndefined()
    expect(f.locate).toHaveBeenCalledWith('/input/profile')
    expect(f.run).toHaveBeenNthCalledWith(1, '/bin/df', ['-P', '/resolved/profile'])
    expect(f.run).toHaveBeenNthCalledWith(2, '/usr/sbin/diskutil', ['info', '-plist', '/dev/disk3s5'])
    expect(f.run).toHaveBeenNthCalledWith(3, '/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'],
      '<plist><dict>verified OS report</dict></plist>')
  })

  it('rejects disabled, transitioning, missing or incorrectly typed encryption flags', async () => {
    for (const flags of [{ ...report, FileVault: false }, { ...report, Encryption: false },
      { ...report, EncryptionThisVolumeProper: false }, { FileVault: true, Encryption: true },
      { ...report, FileVault: 'true' }]) {
      const f = fixture()
      f.run.mockImplementation(async (command) => command === '/bin/df'
        ? 'Filesystem blocks Used Avail Capacity Mounted\n/dev/disk3s5 100 20 80 20% /Data\n'
        : command === '/usr/sbin/diskutil' ? '<plist/>' : JSON.stringify(flags))
      await expect(f.guard.assert('/input/profile')).rejects.toMatchObject({ code: 'storage_protection_required' })
    }
  })

  it('fails closed on unsupported platforms, unknown devices, malformed output and probe errors', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const f = fixture(platform)
      await expect(f.guard.assert('/input/profile')).rejects.toMatchObject({ code: 'storage_protection_required' })
      expect(f.run).not.toHaveBeenCalled()
    }
    for (const output of ['bad report', 'Filesystem blocks\nnetwork-server:/share 1 1 0 100% /Volumes/share\n',
      'Filesystem blocks\n/dev/disk3s5;unexpected 1 1 0 100% /Data\n']) {
      const f = fixture()
      f.run.mockResolvedValue(output)
      await expect(f.guard.assert('/input/profile')).rejects.toMatchObject({ code: 'storage_protection_required' })
    }
    const f = fixture()
    f.run.mockRejectedValue(new Error('Raw host details must not escape'))
    await expect(f.guard.assert('/input/profile')).rejects.toThrow('verified encrypted local storage')
  })

  it('coalesces checks briefly while re-resolving profile paths and detecting changed filesystems', async () => {
    const f = fixture()
    await Promise.all([f.guard.assert('/input/profile'), f.guard.assert('/input/profile')])
    expect(f.run).toHaveBeenCalledTimes(3)
    await f.guard.assert('/input/profile')
    expect(f.locate).toHaveBeenCalledTimes(3)
    expect(f.run).toHaveBeenCalledTimes(3)
    f.location.filesystemId = 'different-device'
    await f.guard.assert('/input/profile')
    expect(f.run).toHaveBeenCalledTimes(6)
    f.advance()
    await f.guard.assert('/input/profile')
    expect(f.run).toHaveBeenCalledTimes(9)
  })

  it('resolves a symlink and missing profile directory to the physical existing parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-gmail-storage-'))
    cleanups.push(root)
    const target = join(root, 'physical')
    await mkdir(target)
    await symlink(target, join(root, 'alias'))
    const found = await locateStorage(join(root, 'alias', 'not-created', 'profile'))
    expect(found.path).toBe(await realpath(target))
    expect(found.filesystemId).toMatch(/^\d+$/)
    const file = join(root, 'not-directory')
    await writeFile(file, 'data')
    await expect(locateStorage(file)).rejects.toThrow('not a directory')
  })
})
