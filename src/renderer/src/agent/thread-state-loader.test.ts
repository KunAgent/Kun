import { describe, expect, it, vi } from 'vitest'
import type { AgentProvider, ThreadRuntimeState } from './provider-types'
import {
  loadThreadStates,
  THREAD_STATE_BATCH_MAX_IDS,
  THREAD_STATE_FALLBACK_CONCURRENCY
} from './thread-state-loader'

const idleState = (id: string): ThreadRuntimeState => ({
  status: 'idle',
  updatedAt: '',
  latestSeq: Number(id.replace(/\D/g, '')) || 0,
  pendingUserInputIds: []
})

describe('loadThreadStates', () => {
  it('falls back from an unavailable batch route with bounded single reads', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `thr_${index}`)
    let active = 0
    let maxActive = 0
    const provider = {
      getThreadStates: vi.fn(async () => {
        throw new Error(JSON.stringify({ code: 'not_found', message: 'legacy route not found' }))
      }),
      getThreadState: vi.fn(async (id: string) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 0))
        active -= 1
        return idleState(id)
      })
    } satisfies Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>

    const results = await loadThreadStates(provider, ids)

    expect(provider.getThreadStates).toHaveBeenCalledWith(ids)
    expect(provider.getThreadState).toHaveBeenCalledTimes(20)
    expect(maxActive).toBe(THREAD_STATE_FALLBACK_CONCURRENCY)
    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('does not fan out single reads after a transient batch failure', async () => {
    const provider = {
      getThreadStates: vi.fn(async () => {
        throw new Error(JSON.stringify({ code: 'runtime_offline', message: 'restarting' }))
      }),
      getThreadState: vi.fn()
    } satisfies Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>

    const results = await loadThreadStates(provider, ['thr_1', 'thr_2'])

    expect(provider.getThreadState).not.toHaveBeenCalled()
    expect(results).toEqual([
      expect.objectContaining({ id: 'thr_1', ok: false }),
      expect.objectContaining({ id: 'thr_2', ok: false })
    ])
  })

  it('chunks large batches sequentially and merges results in order', async () => {
    const ids = Array.from(
      { length: THREAD_STATE_BATCH_MAX_IDS + 50 },
      (_, index) => `thr_${index}`
    )
    const calls: string[][] = []
    let pending = false
    const provider = {
      getThreadStates: vi.fn(async (chunk: string[]) => {
        // Sequential chunking must never overlap two batch requests.
        expect(pending).toBe(false)
        pending = true
        calls.push(chunk)
        await new Promise((resolve) => setTimeout(resolve, 0))
        pending = false
        return chunk.map((id) => ({ id, ok: true as const, state: idleState(id) }))
      }),
      getThreadState: vi.fn()
    } satisfies Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>

    const results = await loadThreadStates(provider, ids)

    expect(provider.getThreadState).not.toHaveBeenCalled()
    expect(calls).toEqual([
      ids.slice(0, THREAD_STATE_BATCH_MAX_IDS),
      ids.slice(THREAD_STATE_BATCH_MAX_IDS)
    ])
    expect(results.map((result) => result.id)).toEqual(ids)
    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('falls back to single reads when a later chunk hits a legacy runtime', async () => {
    const ids = Array.from(
      { length: THREAD_STATE_BATCH_MAX_IDS + 1 },
      (_, index) => `thr_${index}`
    )
    const provider = {
      getThreadStates: vi.fn(async (chunk: string[]) => {
        if (chunk.length > 1) {
          throw new Error(JSON.stringify({ code: 'not_implemented', message: 'legacy runtime' }))
        }
        return [{ id: chunk[0], ok: true as const, state: idleState(chunk[0]) }]
      }),
      getThreadState: vi.fn(async (id: string) => idleState(id))
    } satisfies Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>

    const results = await loadThreadStates(provider, ids)

    expect(provider.getThreadState).toHaveBeenCalledTimes(ids.length)
    expect(results.every((result) => result.ok)).toBe(true)
    expect(results.map((result) => result.id)).toEqual(ids)
  })
})
