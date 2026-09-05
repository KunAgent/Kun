import { describe, expect, it, vi } from 'vitest'
import { ManagerRemoteSessionStore } from './remote-data-stores.js'

describe('ManagerRemoteSessionStore event watch', () => {
  it('checks the cheap high-water mark without rescanning an unchanged event log', async () => {
    const store = new ManagerRemoteSessionStore(null as never)
    const highestSeq = vi.spyOn(store, 'highestSeq').mockResolvedValue(42)
    const loadEventsSince = vi.spyOn(store, 'loadEventsSince').mockResolvedValue([])
    const abort = new AbortController()
    const iterator = store.watchEventsSince('thread_idle', 42, abort.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()

    await vi.waitFor(() => expect(highestSeq).toHaveBeenCalledTimes(1))
    expect(loadEventsSince).not.toHaveBeenCalled()
    abort.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('loads the durable tail when the manager high-water mark advances', async () => {
    const store = new ManagerRemoteSessionStore(null as never)
    vi.spyOn(store, 'highestSeq').mockResolvedValue(43)
    const event = {
      kind: 'heartbeat' as const,
      threadId: 'thread_live',
      seq: 43,
      timestamp: '2026-08-28T00:00:00.000Z'
    }
    const loadEventsSince = vi.spyOn(store, 'loadEventsSince').mockResolvedValue([event])
    const abort = new AbortController()
    const iterator = store.watchEventsSince('thread_live', 42, abort.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: event })
    expect(loadEventsSince).toHaveBeenCalledWith('thread_live', 42)
    abort.abort()
    await iterator.return?.()
  })
})
