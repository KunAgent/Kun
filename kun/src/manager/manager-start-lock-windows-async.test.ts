import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagerStartLockError, type StartLockDiagnostic } from './manager-start-lock-diagnostics.js'

const native = vi.hoisted(() => ({
  acquireStartLock: vi.fn(),
  writeStartLock: vi.fn(),
  releaseStartLock: vi.fn()
}))
vi.mock('../process/windows-startup-native.js', () => ({ windowsStartupNative: () => native }))
vi.mock('./manager-start-lock-diagnostics.js', async (original) => ({
  ...await original<typeof import('./manager-start-lock-diagnostics.js')>(),
  classifyStartLock: vi.fn()
}))

import { classifyStartLock } from './manager-start-lock-diagnostics.js'
import { withWindowsManagerStartLock } from './manager-start-lock-windows-async.js'

const handle = {}
function run(action: () => Promise<unknown>, signal?: AbortSignal) {
  const diagnostic: StartLockDiagnostic = {
    path: '/profile/.manager-start.lock', scope: 'manager', phase: 'acquire', waitedMs: 0, attemptId: 'attempt'
  }
  return withWindowsManagerStartLock({
    path: diagnostic.path,
    owner: 'owner',
    action,
    signal,
    deadline: performance.now() + 5_000,
    diagnostic,
    check: () => signal?.throwIfAborted(),
    fail: (reason) => { throw new ManagerStartLockError(reason, { ...diagnostic }) }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  native.acquireStartLock.mockResolvedValue({ handle, created: true, text: '' })
  native.writeStartLock.mockResolvedValue(undefined)
  native.releaseStartLock.mockResolvedValue(undefined)
})

describe('asynchronous Windows startup admission', () => {
  it('holds the native handle across publication and the critical section', async () => {
    const action = vi.fn(async () => 'ready')
    await expect(run(action)).resolves.toBe('ready')
    expect(native.writeStartLock).toHaveBeenCalledWith(handle, 'owner')
    expect(native.writeStartLock).toHaveBeenCalledBefore(action)
    expect(action).toHaveBeenCalledBefore(native.releaseStartLock)
    expect(native.releaseStartLock).toHaveBeenCalledWith(handle, true)
  })

  it.each(['alive', 'unknown'] as const)('does not overwrite an %s owner', async (state) => {
    native.acquireStartLock.mockResolvedValue({ handle, created: false, text: 'prior' })
    vi.mocked(classifyStartLock).mockReturnValue({ state, pid: 42 })
    const action = vi.fn()
    await expect(run(action)).rejects.toMatchObject({ reason: 'unverifiable' })
    expect(native.writeStartLock).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    expect(native.releaseStartLock).toHaveBeenCalledWith(handle, false)
  })

  it('releases an acquired handle after cancellation without starting work', async () => {
    const controller = new AbortController()
    native.acquireStartLock.mockImplementation(async () => {
      controller.abort(new Error('quit'))
      return { handle, created: true, text: '' }
    })
    const action = vi.fn()
    await expect(run(action, controller.signal)).rejects.toThrow('quit')
    expect(native.writeStartLock).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    expect(native.releaseStartLock).toHaveBeenCalledWith(handle, true)
  })

  it('preserves both a business failure and a lock cleanup failure', async () => {
    const failure = new Error('business failure')
    const cleanup = new Error('release failed')
    native.releaseStartLock.mockRejectedValue(cleanup)
    const action = vi.fn().mockRejectedValue(failure)
    await expect(run(action)).rejects.toMatchObject({ errors: [failure, expect.any(ManagerStartLockError)], cause: failure })
    expect(action).toHaveBeenCalledTimes(1)
  })
})
