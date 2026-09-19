import { describe, expect, it, vi } from 'vitest'
import { ManagedRuntimeShutdownCoordinator } from './managed-runtime-shutdown-coordinator'

describe('ManagedRuntimeShutdownCoordinator', () => {
  it('marks quit intent before awaiting one shared stop operation', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const stop = vi.fn(() => gate)
    const coordinator = new ManagedRuntimeShutdownCoordinator(stop)

    const first = coordinator.stopForQuit()
    const second = coordinator.stopForQuit()
    expect(coordinator.isQuitInProgress).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
    release()
    await Promise.all([first, second])
    expect(coordinator.isStoppedForQuit).toBe(true)
  })

  it('remains terminal when a runtime adapter fails to stop', async () => {
    const coordinator = new ManagedRuntimeShutdownCoordinator(async () => {
      throw new Error('stop failed')
    })
    await expect(coordinator.stopForQuit()).rejects.toThrow('stop failed')
    expect(coordinator.isQuitInProgress).toBe(true)
    expect(coordinator.isStoppedForQuit).toBe(false)
  })

  it('allows a non-terminal window-close stop to be invoked again later', async () => {
    const stop = vi.fn(async () => undefined)
    const coordinator = new ManagedRuntimeShutdownCoordinator(stop)
    await coordinator.stop()
    await coordinator.stop()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(coordinator.isQuitInProgress).toBe(false)
  })

  it('prepares an update without making a failed installer attempt terminal', async () => {
    const stop = vi.fn(async () => undefined)
    const coordinator = new ManagedRuntimeShutdownCoordinator(stop)

    await coordinator.prepareForUpdate()

    expect(coordinator.isUpdateInstallQuit).toBe(true)
    expect(coordinator.isStoppedForQuit).toBe(false)
    expect(stop).toHaveBeenCalledOnce()

    await coordinator.stopForQuit()
    expect(stop).toHaveBeenCalledOnce()
    expect(coordinator.isStoppedForQuit).toBe(true)
  })

  it('clears update intent and remains retryable when update preparation fails', async () => {
    const stop = vi.fn()
      .mockRejectedValueOnce(new Error('stop failed'))
      .mockResolvedValueOnce(undefined)
    const coordinator = new ManagedRuntimeShutdownCoordinator(stop)

    await expect(coordinator.prepareForUpdate()).rejects.toThrow('stop failed')
    expect(coordinator.isUpdateInstallQuit).toBe(false)
    expect(coordinator.isStoppedForQuit).toBe(false)

    await coordinator.prepareForUpdate()
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('repeats an in-flight non-update stop before declaring update preparation complete', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const observedUpdateIntent: boolean[] = []
    let coordinator!: ManagedRuntimeShutdownCoordinator
    const stop = vi.fn(async () => {
      observedUpdateIntent.push(coordinator.isUpdateInstallQuit)
      if (observedUpdateIntent.length === 1) await gate
    })
    coordinator = new ManagedRuntimeShutdownCoordinator(stop)

    const normalStop = coordinator.stop()
    const updatePreparation = coordinator.prepareForUpdate()
    release()
    await Promise.all([normalStop, updatePreparation])

    expect(observedUpdateIntent).toEqual([false, true])
    await coordinator.stopForQuit()
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('treats storage relocation as terminal quit intent', () => {
    const coordinator = new ManagedRuntimeShutdownCoordinator(async () => undefined)
    coordinator.setStorageRelocationQuit(true)
    expect(coordinator.isStorageRelocationQuit).toBe(true)
    expect(coordinator.isQuitInProgress).toBe(true)
  })
})
