import { describe, expect, it, vi } from 'vitest'
import { ThreadReadCoordinator, ThreadReadOverloadedError } from './thread-read-coordinator.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ThreadReadCoordinator', () => {
  it('coalesces twenty identical reads into one storage operation', async () => {
    const pending = deferred<string>()
    const operation = vi.fn(() => pending.promise)
    const coordinator = new ThreadReadCoordinator()
    const reads = Array.from({ length: 20 }, () => coordinator.run('same', 'foreground', operation))

    expect(operation).toHaveBeenCalledOnce()
    pending.resolve('done')
    await expect(Promise.all(reads)).resolves.toEqual(Array(20).fill('done'))
    expect(coordinator.stats()).toMatchObject({ joined: 19, started: 1, rejected: 0 })
  })

  it('bounds queued work and reports retryable overload', async () => {
    const pending = deferred<void>()
    const coordinator = new ThreadReadCoordinator({ foreground: 1, background: 1, queued: 1 })
    const active = coordinator.run('active', 'foreground', () => pending.promise)
    const queued = coordinator.run('queued', 'foreground', async () => undefined)

    await expect(coordinator.run('overflow', 'foreground', async () => undefined))
      .rejects.toBeInstanceOf(ThreadReadOverloadedError)
    pending.resolve()
    await Promise.all([active, queued])
    expect(coordinator.stats().rejected).toBe(1)
  })

  it('does not start background work while foreground work is active', async () => {
    const foreground = deferred<void>()
    const order: string[] = []
    const coordinator = new ThreadReadCoordinator()
    const first = coordinator.run('foreground', 'foreground', async () => {
      order.push('foreground')
      await foreground.promise
    })
    const second = coordinator.run('background', 'background', async () => {
      order.push('background')
    })
    await Promise.resolve()
    expect(order).toEqual(['foreground'])
    foreground.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['foreground', 'background'])
  })

  it('promotes a queued background read when a foreground waiter joins', async () => {
    const firstBlock = deferred<void>()
    const secondBlock = deferred<void>()
    const coordinator = new ThreadReadCoordinator()
    const first = coordinator.run('fg1', 'foreground', () => firstBlock.promise)
    const second = coordinator.run('fg2', 'foreground', () => secondBlock.promise)
    await Promise.resolve()

    // Two foreground slots are taken, so the background read is queued.
    const operation = vi.fn(() => Promise.resolve('same'))
    const background = coordinator.run('same', 'background', operation)
    await Promise.resolve()
    expect(operation).not.toHaveBeenCalled()

    // A foreground waiter joins the still-queued background read and upgrades it.
    const foregroundJoin = coordinator.run('same', 'foreground', operation)
    expect(coordinator.stats()).toMatchObject({
      activeForeground: 2,
      queuedForeground: 1,
      queuedBackground: 0,
      joined: 1,
      promoted: 1
    })

    // Freeing a foreground slot starts the promoted read under foreground limits.
    firstBlock.resolve()
    await expect(Promise.all([background, foregroundJoin])).resolves.toEqual(['same', 'same'])
    expect(operation).toHaveBeenCalledOnce()

    secondBlock.resolve()
    await Promise.all([first, second])
  })

  it('does not double-count a foreground join of an already-running background read', async () => {
    const pending = deferred<string>()
    const operation = vi.fn(() => pending.promise)
    const coordinator = new ThreadReadCoordinator()

    // No foreground work yet, so the background read starts immediately.
    const background = coordinator.run('same', 'background', operation)
    await Promise.resolve()
    expect(operation).toHaveBeenCalledOnce()
    expect(coordinator.stats()).toMatchObject({ activeBackground: 1, activeForeground: 0 })

    const foreground = coordinator.run('same', 'foreground', operation)
    expect(coordinator.stats()).toMatchObject({
      joined: 1,
      promoted: 0,
      activeBackground: 1,
      activeForeground: 0
    })

    pending.resolve('done')
    await expect(Promise.all([background, foreground])).resolves.toEqual(['done', 'done'])
    expect(operation).toHaveBeenCalledOnce()
  })
})
