import { describe, expect, it, vi } from 'vitest'
import { dispatchKunRuntimeEvents } from '../agent/kun-mapper-events'
import type { ThreadEventSink } from '../agent/types'
import { createBatchedStoreAccess, type StorePatch } from './chat-store-batch'

type MiniState = { value: number; flag: boolean }

function applyPatch(state: MiniState, patch: StorePatch<MiniState>): MiniState {
  return { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
}

function makeStore() {
  let state: MiniState = { value: 0, flag: false }
  const set = vi.fn((patch: StorePatch<MiniState>) => {
    state = applyPatch(state, patch)
  })
  return { set, get: () => state, state: () => state }
}

describe('createBatchedStoreAccess', () => {
  it('commits queued patches once when the batch flushes', async () => {
    const store = makeStore()
    const batch = createBatchedStoreAccess(store.set, store.get)

    await batch.run(async () => {
      batch.set({ value: 1 })
      batch.set((s) => ({ value: s.value + 1 }))
      expect(batch.get().value).toBe(2)
      expect(store.set).not.toHaveBeenCalled()
    })
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.state()).toEqual({ value: 2, flag: false })
  })

  it('keeps external writes made mid-batch', async () => {
    const store = makeStore()
    const batch = createBatchedStoreAccess(store.set, store.get)

    await batch.run(async () => {
      batch.set({ value: 5 })
      store.set({ flag: true })
      batch.set((s) => ({ value: s.value + 1 }))
    })
    expect(store.state()).toEqual({ value: 6, flag: true })
  })

  it('passes writes through outside a batch and supports nesting', async () => {
    const store = makeStore()
    const batch = createBatchedStoreAccess(store.set, store.get)

    batch.set({ value: 1 })
    expect(store.set).toHaveBeenCalledTimes(1)

    await batch.run(async () => {
      batch.set({ value: 2 })
      await batch.run(async () => {
        batch.set({ value: 3 })
      })
      expect(store.set).toHaveBeenCalledTimes(1)
    })
    expect(store.set).toHaveBeenCalledTimes(2)
    expect(store.state().value).toBe(3)
  })

  it('runs effects after the outer commit and lets them write to the real store', async () => {
    const store = makeStore()
    const batch = createBatchedStoreAccess(store.set, store.get)
    const observed: number[] = []

    await batch.run(async () => {
      batch.set({ value: 1 })
      await batch.run(async () => {
        batch.afterCommit(() => {
          observed.push(store.get().value)
          batch.set({ flag: true })
        })
      })
      batch.set({ value: 2 })
      batch.afterCommit(() => observed.push(store.get().value))
      expect(observed).toEqual([])
    })

    expect(observed).toEqual([2, 2])
    expect(store.state()).toEqual({ value: 2, flag: true })
    expect(store.set).toHaveBeenCalledTimes(2)
    batch.afterCommit(() => observed.push(3))
    expect(observed).toEqual([2, 2, 3])
  })

  it('preserves completed event effects when a later event fails', async () => {
    const store = makeStore()
    const batch = createBatchedStoreAccess(store.set, store.get)
    const observed: number[] = []

    await expect(batch.run(async () => {
      batch.set({ value: 1 })
      batch.afterCommit(() => observed.push(store.get().value))
      throw new Error('later event failed')
    })).rejects.toThrow('later event failed')

    await batch.run(async () => { batch.set({ value: 2 }) })
    expect(observed).toEqual([1])
    expect(store.state().value).toBe(2)
  })
})

describe('dispatchKunRuntimeEvents batching', () => {
  it('routes the whole batch through sink.runEventBatch when present', async () => {
    const calls: string[] = []
    const sink: ThreadEventSink = {
      runEventBatch: async (work) => {
        calls.push('begin')
        const result = await work()
        calls.push('end')
        return result
      },
      onSeq: () => undefined,
      onDeltas: () => {
        calls.push('deltas')
      },
      onUserMessage: () => undefined,
      onTool: () => undefined,
      onCompaction: () => undefined,
      onApproval: () => undefined,
      onUserInput: () => undefined,
      onUserInputStatus: () => undefined,
      onGoal: () => undefined,
      onTurnComplete: () => undefined,
      onError: () => undefined
    }

    const delta = (seq: number) => ({
      kind: 'assistant_text_delta' as const,
      seq,
      deltaOffset: seq - 1,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant' as const,
        status: 'running' as const,
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text' as const,
        text: `chunk_${seq}`
      }
    })
    await dispatchKunRuntimeEvents([delta(1), delta(2)], sink, async () => undefined)
    expect(calls).toEqual(['begin', 'deltas', 'end'])
  })
})
