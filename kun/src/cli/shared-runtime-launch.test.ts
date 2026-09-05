import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  terminateSpawnedRuntime,
  waitForSpawnedSharedRuntime
} from './shared-runtime-launch.js'

describe('spawned shared Runtime ownership', () => {
  it('rejects a foreign ready winner observed after the client-owned candidate exits', async () => {
    const child = exitedChild(10_001)
    const observe = vi.fn()
      .mockResolvedValueOnce({ kind: 'vacant' })
      .mockResolvedValueOnce({ kind: 'ready', value: 'foreign', ownerPid: 10_002 })

    await expect(waitForSpawnedSharedRuntime({
      child,
      deadline: Date.now() + 1_000,
      pollMs: 1,
      observe,
      allowWinningOwner: false,
      timeoutError: () => new Error('timed out')
    })).rejects.toThrow('another Runtime process 10002 won client-owned startup')
    expect(observe).toHaveBeenCalledTimes(2)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('still permits a shared caller to reuse that post-exit winner', async () => {
    const child = exitedChild(10_003)
    const observe = vi.fn()
      .mockResolvedValueOnce({ kind: 'vacant' })
      .mockResolvedValueOnce({ kind: 'ready', value: 'shared-winner', ownerPid: 10_004 })

    await expect(waitForSpawnedSharedRuntime({
      child,
      deadline: Date.now() + 1_000,
      pollMs: 1,
      observe,
      timeoutError: () => new Error('timed out')
    })).resolves.toBe('shared-winner')
  })

  it('does not treat child errors as exit while the exact PID remains live', async () => {
    const child = liveErroringChild(10_005)

    await expect(terminateSpawnedRuntime(child)).rejects.toThrow(
      'Kun shared runtime candidate PID 10005 remained alive'
    )
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })

  it('treats a child without an assigned PID as already exited', async () => {
    const child = exitedChild(10_006)
    Object.defineProperty(child, 'pid', { value: undefined })
    Object.defineProperty(child, 'exitCode', { value: null })

    await expect(terminateSpawnedRuntime(child)).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
  })
})

function exitedChild(pid: number): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    exitCode: number
    signalCode: NodeJS.Signals | null
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = pid
  child.exitCode = 17
  child.signalCode = null
  child.kill = vi.fn()
  return child as unknown as ChildProcess
}

function liveErroringChild(pid: number): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('error', new Error('signal delivery failed')))
    return false
  })
  return child as unknown as ChildProcess
}
