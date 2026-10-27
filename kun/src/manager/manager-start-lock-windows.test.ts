import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ acquire: vi.fn(), publish: vi.fn(), release: vi.fn(), inspectProcess: vi.fn() }))
vi.mock('../process/windows-startup-native.js', () => ({ windowsStartupNative: () => native }))
import { withWindowsManagerStartLock } from './manager-start-lock-windows.js'

const handle = {}
const path = 'profile/.manager-start.lock'
const owner = JSON.stringify({ pid: 42, acquiredAt: '2026-01-01T00:00:00Z', processIdentity: 'birth' })
function run(action = vi.fn().mockResolvedValue('ready'), signal?: AbortSignal) {
  const start = performance.now()
  return withWindowsManagerStartLock(path, owner, action, start, start + 20, signal)
}
beforeEach(() => {
  vi.resetAllMocks()
  native.acquire.mockReturnValue({ handle, created: false, text: owner })
  native.inspectProcess.mockReturnValue({ state: 'dead' })
})
afterEach(() => { vi.restoreAllMocks() })

describe('Windows startup owner admission', () => {
  it.each(['', '{', '{}', 'null', '{"pid":-1}'])('recovers damaged metadata only after pinned native acquisition: %s', async (text) => {
    native.acquire.mockReturnValue({ handle, created: false, text })
    await expect(run()).resolves.toBe('ready')
    expect(native.publish).toHaveBeenCalledWith(handle, owner)
    expect(native.release).toHaveBeenCalledTimes(1)
  })
  it('does not inspect or publish while the OS lock is held elsewhere', async () => {
    native.acquire.mockReturnValue(undefined)
    await expect(run()).rejects.toMatchObject({ reason: 'busy' })
    expect(native.publish).not.toHaveBeenCalled()
    expect(native.inspectProcess).not.toHaveBeenCalled()
  })
  it('recovers a verified reused PID', async () => {
    native.inspectProcess.mockReturnValue({ state: 'alive', identity: 'new-birth' })
    await expect(run()).resolves.toBe('ready')
  })
  it('refuses a live owner', async () => {
    native.inspectProcess.mockReturnValue({ state: 'alive', identity: 'birth' })
    await expect(run()).rejects.toMatchObject({ reason: 'busy', ownerPid: 42 })
    expect(native.publish).not.toHaveBeenCalled()
  })
  it('reports unknown identity immediately without deleting the record', async () => {
    native.inspectProcess.mockReturnValue({ state: 'unknown' })
    await expect(run()).rejects.toMatchObject({ reason: 'unverifiable', ownerPid: 42 })
    expect(native.publish).not.toHaveBeenCalled()
    expect(native.release).toHaveBeenCalledTimes(1)
  })
  it('does not authorize legacy takeover from a missing timestamp', async () => {
    native.acquire.mockReturnValue({ handle, created: false, text: '{"pid":42}' })
    native.inspectProcess.mockReturnValue({ state: 'alive', identity: 'birth', startedAtMs: Date.now() })
    await expect(run()).rejects.toMatchObject({ reason: 'busy' })
    expect(native.publish).not.toHaveBeenCalled()
  })
  it('classifies inaccessible files without treating them as contention', async () => {
    native.acquire.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    await expect(run()).rejects.toMatchObject({ reason: 'io', filesystemCode: 'EACCES' })
    expect(native.acquire).toHaveBeenCalledTimes(1)
  })
  it('releases on publication failure without running the action', async () => {
    native.publish.mockImplementation(() => { throw new Error('disk') })
    const action = vi.fn()
    await expect(run(action)).rejects.toThrow('disk')
    expect(action).not.toHaveBeenCalled()
    expect(native.release).toHaveBeenCalledTimes(1)
  })
  it('never replays business EEXIST', async () => {
    const action = vi.fn().mockRejectedValue(Object.assign(new Error('business'), { code: 'EEXIST' }))
    await expect(run(action)).rejects.toThrow('business')
    expect(action).toHaveBeenCalledTimes(1)
    expect(native.release).toHaveBeenCalledTimes(1)
  })
  it('cancels before publish even when native acquisition has just succeeded', async () => {
    const abort = new AbortController()
    native.acquire.mockImplementation(() => {
      abort.abort(new Error('quit'))
      return { handle, created: true, text: '' }
    })
    const action = vi.fn()
    await expect(run(action, abort.signal)).rejects.toThrow('quit')
    expect(action).not.toHaveBeenCalled()
    expect(native.publish).not.toHaveBeenCalled()
    expect(native.release).toHaveBeenCalledTimes(1)
  })
})
