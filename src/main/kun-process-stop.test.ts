import { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KUN_STOP_FORCE_MS,
  KUN_STOP_GRACE_MS,
  processController
} from './kun-process-state'

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
    const originalKill = process.kill.bind(process)
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid, signal) => {
      if (pid === childPid) return true
      return originalKill(pid, signal)
    }) as typeof process.kill)
    processController.child = child

    const module = await import('./kun-process')
    const stopped = expect(module.stopKunChildAndWait()).rejects.toThrow(
      `Kun runtime process ${childPid} remained alive after SIGKILL`
    )
    await vi.advanceTimersByTimeAsync(KUN_STOP_GRACE_MS + KUN_STOP_FORCE_MS)
    await stopped

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(kill).toHaveBeenCalledWith(childPid, 'SIGKILL')
    expect(processController.child).toBe(child)
    expect(module.isKunChildRunning()).toBe(true)
  })
})
