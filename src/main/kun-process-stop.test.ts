import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  processController
} from './kun-process-state'
import { stopOwnedProcess } from '../../kun/src/process/owned-process.js'

vi.mock('../../kun/src/process/owned-process.js', () => ({
  stopOwnedProcess: vi.fn(),
  spawnOwnedProcess: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/deepseek-gui-test-app',
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

afterEach(() => {
  const child = processController.child
  if (child) processController.clearChild(child)
  processController.logCapture = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('stopKunChildAndWait', () => {
  it('keeps the exact child supervised when it remains alive after SIGKILL', async () => {
    vi.useFakeTimers()
    const childPid = 2_147_483_600
    const child = Object.assign(new EventEmitter(), {
      pid: childPid,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true)
    }) as unknown as ChildProcess
    vi.mocked(stopOwnedProcess).mockRejectedValueOnce(new Error('Owned process group did not exit before deadline'))
    processController.child = child

    const module = await import('./kun-process')
    const stopped = expect(module.stopKunChildAndWait()).rejects.toThrow(
      'Owned process group did not exit before deadline'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await stopped

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(stopOwnedProcess).toHaveBeenCalledWith(child, { graceMs: 0, timeoutMs: 5_000 })
    expect(processController.child).toBe(child)
    expect(module.isKunChildRunning()).toBe(true)
  })
})
