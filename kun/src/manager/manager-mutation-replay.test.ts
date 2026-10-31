import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '../server/response.js'
import { ManagerMutationReplayCache } from './manager-mutation-replay.js'

const token = () => ({ requestId: randomUUID(), managerInstanceId: 'manager', expiresAt: 30_000 })
const cache = (entries = 4_096, bytes = 1024 * 1024, now = () => 1) =>
  new ManagerMutationReplayCache('manager', { entries, bytes }, now)

describe('Manager mutation replay cache', () => {
  it('retains a burst of parallel stream acknowledgements throughout their retry window', async () => {
    const dedup = new ManagerMutationReplayCache('manager', undefined, () => 1)
    const first = token()
    const run = vi.fn(async () => jsonResponse({ result: 1 }))
    await dedup.execute(first, {}, run)
    for (let index = 0; index < 5_000; index += 1) {
      expect((await dedup.execute(token(), {}, run)).status).toBe(200)
    }
    expect((await dedup.execute(first, {}, run)).status).toBe(200)
    expect(run).toHaveBeenCalledTimes(5_001)
  })

  it('shares in-flight work and replays the committed response without reapplying the write', async () => {
    const dedup = cache(), replay = token()
    let finish!: () => void
    const run = vi.fn(async () => {
      await new Promise<void>(resolve => { finish = resolve })
      return jsonResponse({ result: 42 })
    })
    const first = dedup.execute(replay, ['allocate', 'thread'], run)
    const second = dedup.execute(replay, ['allocate', 'thread'], run)
    await Promise.resolve()
    expect(run).toHaveBeenCalledOnce()
    finish()
    expect(await second).toEqual(await first)
    expect(await dedup.execute(replay, ['allocate', 'thread'], run)).toEqual(await first)
    expect(run).toHaveBeenCalledOnce()
  })

  it('rejects changed payloads, stale Manager generations, and expired replay windows', async () => {
    const dedup = cache(), replay = token()
    const run = vi.fn(async () => jsonResponse({ result: null }))
    await dedup.execute(replay, { value: 1 }, run)
    expect((await dedup.execute(replay, { value: 2 }, run)).status).toBe(409)
    expect((await dedup.execute({ ...replay, managerInstanceId: 'old' }, {}, run)).status).toBe(409)
    expect((await dedup.execute({ ...replay, expiresAt: 1 }, {}, run)).status).toBe(409)
    expect((await dedup.execute({ ...replay, expiresAt: 150_000 }, {}, run)).status).toBe(409)
    expect(run).toHaveBeenCalledOnce()
  })

  it('keeps unexpired deduplication records on overload and admits again after expiry', async () => {
    let now = 1
    const dedup = cache(1, 1024, () => now), replay = token()
    const run = vi.fn(async () => jsonResponse({ result: 1 }))
    await dedup.execute(replay, {}, run)
    expect((await dedup.execute(token(), {}, run)).status).toBe(503)
    expect((await dedup.execute(replay, {}, run)).status).toBe(200)
    expect(run).toHaveBeenCalledOnce()
    now = 30_001
    expect((await dedup.execute({ ...token(), expiresAt: now + 30_000 }, {}, run)).status).toBe(200)
    expect((await dedup.execute(replay, {}, run)).status).toBe(409)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never repeats partial failures or oversized responses', async () => {
    const dedup = cache(4, 10), replay = token()
    const failed = vi.fn(async () => { throw new Error('partial commit') })
    await expect(dedup.execute(replay, {}, failed)).rejects.toThrow('partial commit')
    expect((await dedup.execute(replay, {}, failed)).status).toBe(503)
    expect(failed).toHaveBeenCalledOnce()
    const large = token(), run = vi.fn(async () => jsonResponse({ result: 'x'.repeat(100) }))
    expect((await dedup.execute(large, {}, run)).status).toBe(200)
    expect((await dedup.execute(large, {}, run)).status).toBe(503)
    expect(run).toHaveBeenCalledOnce()
  })
})
