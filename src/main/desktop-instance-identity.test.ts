import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureDesktopInstanceIdentity,
  decideDesktopInstanceLock,
  formatDesktopInstanceConflictMessage,
  readDesktopInstanceIdentity,
  writeDesktopInstanceIdentity
} from './desktop-instance-identity'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function identity(overrides: Partial<{
  pid: number
  execPath: string
  appPath: string
  appVersion: string
}> = {}) {
  return captureDesktopInstanceIdentity({
    pid: overrides.pid ?? 11,
    execPath: overrides.execPath ?? '/Applications/Kun.app/Contents/MacOS/Kun',
    appPath: overrides.appPath ?? '/Applications/Kun.app/Contents/Resources/app.asar',
    appVersion: overrides.appVersion ?? '0.3.10',
    startedAt: '2026-09-20T03:00:00.000Z'
  })
}

describe('desktop instance identity', () => {
  it('reuses the existing window when the recorded app path and version match', () => {
    const current = identity()
    expect(decideDesktopInstanceLock(current, current)).toEqual({ action: 'reuse' })
  })

  it('reuses the existing window when no recorded identity is available', () => {
    expect(decideDesktopInstanceLock(identity(), null)).toEqual({ action: 'reuse' })
  })

  it('conflicts when another Kun is running from a different path', () => {
    const current = identity()
    const recorded = identity({
      execPath: '/tmp/worktree/Kun.app/Contents/MacOS/Kun',
      appPath: '/tmp/worktree/Kun.app/Contents/Resources/app.asar',
      appVersion: '0.3.9'
    })
    expect(decideDesktopInstanceLock(current, recorded)).toEqual({
      action: 'conflict',
      current,
      recorded
    })
    expect(formatDesktopInstanceConflictMessage(current, recorded)).toContain('0.3.9')
    expect(formatDesktopInstanceConflictMessage(current, recorded)).toContain('0.3.10')
    expect(formatDesktopInstanceConflictMessage(current, recorded)).toContain('will not start a second workbench')
  })

  it('conflicts when the path matches but the version does not', () => {
    const current = identity({ appVersion: '0.3.10' })
    const recorded = identity({ appVersion: '0.3.9' })
    expect(decideDesktopInstanceLock(current, recorded).action).toBe('conflict')
  })

  it('round-trips a recorded identity through userData', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-desktop-instance-'))
    roots.push(root)
    const recorded = identity({ pid: 99 })
    writeDesktopInstanceIdentity(root, recorded)
    expect(readDesktopInstanceIdentity(root)).toEqual(recorded)
  })

  it('ignores a corrupt identity file instead of guessing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-desktop-instance-'))
    roots.push(root)
    await writeFile(join(root, 'desktop-instance.json'), '{not-json', 'utf8')
    expect(readDesktopInstanceIdentity(root)).toBeNull()
  })
})
