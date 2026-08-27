import { describe, expect, it, vi } from 'vitest'
import {
  packagedUpdateHandoffInspectionDenied,
  terminateVerifiedPid
} from './kun-process-ports'

describe('terminateVerifiedPid platform safety', () => {
  it('denies inspection only inside the doubly opted-in packaged smoke', () => {
    expect(packagedUpdateHandoffInspectionDenied({
      KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE: '1',
      KUN_PACKAGED_UPDATE_HANDOFF_SMOKE: '1',
      KUN_PACKAGED_UPDATE_HANDOFF_DENY_INSPECTION: '1'
    })).toBe(true)
    expect(packagedUpdateHandoffInspectionDenied({
      KUN_PACKAGED_UPDATE_HANDOFF_DENY_INSPECTION: '1'
    })).toBe(false)
  })
  it('uses TERM then KILL on Unix only while the exact identity remains verified', async () => {
    const kill = vi.fn<typeof process.kill>(() => true)
    const verifyTarget = vi.fn(async () => true)
    const waitForExit = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await expect(terminateVerifiedPid(8123, verifyTarget, waitForExit, {
      platform: 'darwin',
      kill
    })).resolves.toBe(true)

    expect(verifyTarget).toHaveBeenCalledTimes(2)
    expect(kill.mock.calls).toEqual([
      [8123, 'SIGTERM'],
      [8123, 'SIGKILL']
    ])
  })

  it('does not escalate after TERM when the PID identity changed', async () => {
    const kill = vi.fn<typeof process.kill>(() => true)
    const verifyTarget = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(terminateVerifiedPid(8124, verifyTarget, async () => false, {
      platform: 'linux',
      kill
    })).resolves.toBe(false)

    expect(kill).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledWith(8124, 'SIGTERM')
  })

  it('fails closed when Unix signal permission is denied and the PID remains live', async () => {
    const kill = vi.fn<typeof process.kill>(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    })

    await expect(terminateVerifiedPid(8125, async () => true, async () => false, {
      platform: 'linux',
      kill
    })).resolves.toBe(false)

    expect(kill).toHaveBeenCalledWith(8125, 'SIGTERM')
  })

  it('uses the Windows process-tree taskkill path and confirms exit', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }))
    const waitForExit = vi.fn(async () => true)

    await expect(terminateVerifiedPid(8126, async () => true, waitForExit, {
      platform: 'win32',
      execFile: execFile as never
    })).resolves.toBe(true)

    expect(execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '8126', '/T', '/F'],
      { windowsHide: true, timeout: 5_000 }
    )
    expect(waitForExit).toHaveBeenCalledWith(8126, 2_000)
  })
})
