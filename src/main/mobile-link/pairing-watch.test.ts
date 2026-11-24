import { afterEach, describe, expect, it, vi } from 'vitest'
import { PairingWatch } from './pairing-watch'

afterEach(() => vi.useRealTimers())

describe('host pairing reconciliation', () => {
  it.each([10,50,100])('keeps %i dual-enabled idle hosts off the listing endpoints with lease coverage', async count => {
    vi.useFakeTimers()
    const list = vi.fn(async () => {})
    const watchers = Array.from({length:count*2}, () => new PairingWatch(list))
    try {
      for (const watch of watchers) { watch.wake(); watch.setCovered(true) }
      await vi.advanceTimersByTimeAsync(0)
      list.mockClear()
      await vi.advanceTimersByTimeAsync(60000)
      expect(list).not.toHaveBeenCalled()
      // A missed notice is recovered by just the affected purpose on the affected host's renewal.
      watchers[0].wake()
      await vi.advanceTimersByTimeAsync(0)
      expect(list).toHaveBeenCalledTimes(1)
      // Loss of coverage falls back within the existing 20s deadline.
      for (const watch of watchers) watch.setCovered(false)
      await vi.advanceTimersByTimeAsync(10000)
      expect(list).toHaveBeenCalledTimes(1 + watchers.length)
    } finally { for (const watch of watchers) watch.stop() }
  })
  it('coalesces notifications in flight, backs off errors and reconciles on reconnect', async () => {
    vi.useFakeTimers()
    let unblock!: () => void
    const list = vi.fn<() => Promise<void>>().mockImplementationOnce(()=>new Promise(done=>{unblock=done}))
      .mockRejectedValueOnce(Error('503')).mockResolvedValue(undefined)
    const watch=new PairingWatch(list)
    try {
      watch.wake(); watch.wake(); watch.wake()
      await vi.advanceTimersByTimeAsync(12000)
      expect(list).toHaveBeenCalledTimes(1)
      unblock(); await vi.advanceTimersByTimeAsync(0)
      expect(list).toHaveBeenCalledTimes(2)
      watch.wake(); await vi.advanceTimersByTimeAsync(10000)
      expect(list).toHaveBeenCalledTimes(2)
      watch.reconnect(); await vi.advanceTimersByTimeAsync(0)
      expect(list).toHaveBeenCalledTimes(3)
      watch.stop(); await vi.advanceTimersByTimeAsync(60000)
      expect(list).toHaveBeenCalledTimes(3)
    } finally { watch.stop() }
  })
})
