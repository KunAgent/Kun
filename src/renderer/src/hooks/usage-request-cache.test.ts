import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestUsage, resetUsageRequestCacheForTests } from './usage-request-cache'

afterEach(() => {
  vi.useRealTimers()
  resetUsageRequestCacheForTests()
  Reflect.deleteProperty(globalThis, 'window')
  vi.restoreAllMocks()
})

describe('usage request cache', () => {
  it('coalesces one refresh generation and bypasses recent data for the next one', async () => {
    let resolveFirst!: (value: { ok: boolean; status: number; body: string }) => void
    const first = new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
      resolveFirst = resolve
    })
    const runtimeRequest = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue({ ok: true, status: 200, body: '{"generation":2}' })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { kunGui: { runtimeRequest } }
    })

    const left = requestUsage('/v1/usage?group_by=thread', 'thread usage', 1)
    const right = requestUsage('/v1/usage?group_by=thread', 'thread usage', 1)
    expect(runtimeRequest).toHaveBeenCalledOnce()
    resolveFirst({ ok: true, status: 200, body: '{"generation":1}' })
    await expect(Promise.all([left, right])).resolves.toEqual([
      { ok: true, status: 200, body: '{"generation":1}' },
      { ok: true, status: 200, body: '{"generation":1}' }
    ])

    await requestUsage('/v1/usage?group_by=thread', 'thread usage', 1)
    expect(runtimeRequest).toHaveBeenCalledOnce()
    await expect(requestUsage('/v1/usage?group_by=thread', 'thread usage', 2))
      .resolves.toMatchObject({ body: '{"generation":2}' })
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    await requestUsage('/v1/usage?group_by=thread', 'thread usage', 1)
    expect(runtimeRequest).toHaveBeenCalledTimes(3)
  })

  it('waits for Main to settle the transport instead of applying a renderer timeout', async () => {
    let resolve!: (value: { ok: boolean; status: number; body: string }) => void
    const transport = new Promise<{ ok: boolean; status: number; body: string }>((done) => {
      resolve = done
    })
    const runtimeRequest = vi.fn(() => transport)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { kunGui: { runtimeRequest } }
    })

    const first = requestUsage('/v1/usage?group_by=day', 'daily usage', 1)
    const retry = requestUsage('/v1/usage?group_by=day', 'daily usage', 2)
    expect(runtimeRequest).toHaveBeenCalledOnce()
    resolve({ ok: true, status: 200, body: '{"ok":true}' })
    await expect(first).resolves.toMatchObject({ status: 200 })
    await expect(retry).resolves.toMatchObject({ status: 200 })
  })

  it('queues a fresh transport when generation changes during an active request', async () => {
    let resolveFirst!: (value: { ok: boolean; status: number; body: string }) => void
    const first = new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
      resolveFirst = resolve
    })
    const runtimeRequest = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true, status: 200, body: '{"generation":2}' })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { kunGui: { runtimeRequest } }
    })

    const oldGeneration = requestUsage('/v1/usage?group_by=model', 'model usage', 1)
    const newGeneration = requestUsage('/v1/usage?group_by=model', 'model usage', 2)
    expect(runtimeRequest).toHaveBeenCalledOnce()
    resolveFirst({ ok: true, status: 200, body: '{"generation":1}' })

    await expect(oldGeneration).resolves.toMatchObject({ body: '{"generation":1}' })
    await expect(newGeneration).resolves.toMatchObject({ body: '{"generation":2}' })
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
  })
})
