import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueuedTurnDispatcher } from './queued-turn-dispatcher.js'
import { currentTurnMutationFence, runWithTurnMutationFence } from '../manager/turn-mutation-context.js'
import type { ThreadStore } from '../ports/thread-store.js'

afterEach(() => vi.useRealTimers())
function fixture() {
  const startNextQueuedTurn = vi.fn<() => Promise<{ turnId: string } | null>>()
  const runTurn = vi.fn()
  const dispatcher = new QueuedTurnDispatcher({
    turns: { startNextQueuedTurn }, runTurn,
    threadStore: { getMetadata: async () => ({ turns: [{ id: 'next', status: 'queued' }] }) } as unknown as ThreadStore
  })
  return { startNextQueuedTurn, runTurn, dispatcher }
}

describe('queued dispatcher recovery', () => {
  it.each(['error', 'busy'])('retries %s without an unrelated wake and clears the retry after promotion', async (kind) => {
    vi.useFakeTimers()
    const h = fixture()
    if (kind === 'error') h.startNextQueuedTurn.mockRejectedValueOnce(new Error('temporary write failure'))
    else h.startNextQueuedTurn.mockResolvedValueOnce(null)
    h.startNextQueuedTurn.mockResolvedValue({ turnId: 'next' })
    try {
      h.dispatcher.requestDrain('thread')
      await vi.advanceTimersByTimeAsync(10000)
      expect(h.runTurn).toHaveBeenCalledExactlyOnceWith('thread', 'next')
      expect(h.startNextQueuedTurn).toHaveBeenCalledTimes(2)
    } finally { h.dispatcher.dispose() }
  })

  it('Stop cancels recovery and lease-release wakes do not resume the stopped queue', async () => {
    vi.useFakeTimers()
    const h = fixture()
    h.startNextQueuedTurn.mockResolvedValue(null)
    try {
      h.dispatcher.requestDrain('thread')
      await vi.advanceTimersByTimeAsync(0)
      h.dispatcher.onTurnSettled('thread', 'aborted')
      h.dispatcher.onTurnSettled('thread', 'completed')
      await vi.advanceTimersByTimeAsync(15000)
      expect(h.startNextQueuedTurn).toHaveBeenCalledTimes(1)
      h.startNextQueuedTurn.mockResolvedValue({ turnId: 'next' })
      h.dispatcher.requestDrain('thread')
      await vi.advanceTimersByTimeAsync(0)
      expect(h.runTurn).toHaveBeenCalledExactlyOnceWith('thread', 'next')
    } finally { h.dispatcher.dispose() }
  })

  it('never inherits the settled turn fence', async () => {
    const h = fixture()
    h.startNextQueuedTurn.mockImplementation(async () => {
      expect(currentTurnMutationFence()).toBeUndefined()
      return { turnId: 'next' }
    })
    try {
      runWithTurnMutationFence({ threadId: 'thread', turnId: 'old', ownerFlavor: 'production',
        ownerInstanceId: 'owner', fencingToken: 1 }, () => h.dispatcher.onTurnSettled('thread', 'completed'))
      await vi.waitFor(() => expect(h.runTurn).toHaveBeenCalledOnce())
    } finally { h.dispatcher.dispose() }
  })
})
