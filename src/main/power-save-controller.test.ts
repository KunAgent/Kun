import { describe, expect, it, vi } from 'vitest'
import { PowerSaveController } from './power-save-controller'
import type { PowerSaveBlockerLike } from './schedule-runtime-helpers'

function makeBlocker() {
  let nextId = 1
  const started = new Set<number>()
  const stop = vi.fn((id: number) => {
    started.delete(id)
  })
  const blocker: PowerSaveBlockerLike = {
    start: vi.fn((_type) => {
      const id = nextId
      nextId += 1
      started.add(id)
      return id
    }),
    stop,
    isStarted: (id: number) => started.has(id)
  }
  return { blocker, started }
}

describe('PowerSaveController', () => {
  it('starts the blocker on the first acquire and stops it after the last release', () => {
    const { blocker } = makeBlocker()
    const controller = new PowerSaveController(blocker)

    expect(controller.isActive()).toBe(false)
    controller.acquire()
    expect(blocker.start).toHaveBeenCalledWith('prevent-app-suspension')
    expect(controller.isActive()).toBe(true)

    // A second owner acquiring must not start a second blocker.
    controller.acquire()
    expect(blocker.start).toHaveBeenCalledTimes(1)

    controller.release()
    expect(controller.isActive()).toBe(true)
    controller.release()
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(false)
  })

  it('ignores extra releases and never stops an idle blocker', () => {
    const { blocker } = makeBlocker()
    const controller = new PowerSaveController(blocker)
    controller.release()
    controller.release()
    expect(blocker.stop).not.toHaveBeenCalled()
  })

  it('reset force-releases every reference', () => {
    const { blocker } = makeBlocker()
    const controller = new PowerSaveController(blocker)
    controller.acquire()
    controller.acquire()
    controller.reset()
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(false)
  })

  it('keeps the app preference idempotent and releases only its own reference', () => {
    const { blocker } = makeBlocker()
    const controller = new PowerSaveController(blocker)

    controller.setAppKeepAwake(true)
    controller.setAppKeepAwake(true)
    expect(blocker.start).toHaveBeenCalledTimes(1)

    controller.acquire()
    controller.setAppKeepAwake(false)
    expect(blocker.stop).not.toHaveBeenCalled()
    expect(controller.isActive()).toBe(true)

    controller.release()
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(false)
  })

  it('clears the app preference holder on reset so it can be enabled again', () => {
    const { blocker } = makeBlocker()
    const controller = new PowerSaveController(blocker)

    controller.setAppKeepAwake(true)
    controller.reset()
    controller.setAppKeepAwake(true)

    expect(blocker.start).toHaveBeenCalledTimes(2)
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(true)
  })

  it('retries the app preference after a failing blocker start', () => {
    const { blocker } = makeBlocker()
    vi.mocked(blocker.start)
      .mockImplementationOnce(() => {
        throw new Error('blocked')
      })

    const controller = new PowerSaveController(blocker)
    controller.setAppKeepAwake(true)
    expect(controller.isActive()).toBe(false)

    controller.setAppKeepAwake(true)
    expect(blocker.start).toHaveBeenCalledTimes(2)
    expect(controller.isActive()).toBe(true)
  })

  it('backfills the requested app reference when another owner recovers start', () => {
    const { blocker } = makeBlocker()
    vi.mocked(blocker.start)
      .mockImplementationOnce(() => {
        throw new Error('blocked')
      })

    const controller = new PowerSaveController(blocker)
    controller.setAppKeepAwake(true)
    expect(controller.acquire()).toBe(true)

    controller.release()
    expect(blocker.stop).not.toHaveBeenCalled()
    expect(controller.isActive()).toBe(true)

    controller.setAppKeepAwake(false)
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(false)
  })

  it('survives a failing blocker start without leaving stale state', () => {
    const blocker: PowerSaveBlockerLike = {
      start: vi.fn(() => {
        throw new Error('blocked')
      }),
      stop: vi.fn(),
      isStarted: () => false
    }
    const controller = new PowerSaveController(blocker)
    controller.acquire()
    expect(controller.isActive()).toBe(false)
    // A later successful acquire can still take over.
    controller.release()
    expect(controller.isActive()).toBe(false)
  })
})
