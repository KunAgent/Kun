import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestBudget, type RemoteApi } from '@kun/remote-protocol'
import { MobileShareHosts } from './share-host'
afterEach(() => vi.useRealTimers())
function fixture(request: (path: string) => Promise<unknown>) {
  const socket = vi.fn(() => { throw new Error('UNEXPECTED_SOCKET') })
  const host = new MobileShareHosts({ origin: 'https://review.invalid', fetch, socket, budget: new RequestBudget(), totalBudget: new RequestBudget(),
    lease: async () => ({ runtimeToken: 'fake-review', request: async () => ({ ok: true, status: 200, body: '{}' }) }) })
  const context = { api: { request } as unknown as RemoteApi, ownerAccountId: 'owner', hostDeviceId: 'host', current: () => true }
  return { host, socket, context }
}
describe('shared capability discovery recovery stays fail closed', () => {
  it('recovers from the first transient capability failure without toggling remote access', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const request = vi.fn(async (path: string) => {
      if (path === '/capabilities') { if (++attempts === 1) throw Error('TEMPORARY_NETWORK'); return { sharing: { available: true } } }
      return { owned: [], joined: [] }
    })
    const f = fixture(request)
    try {
      f.host.start(f.context); await vi.advanceTimersByTimeAsync(0)
      expect(f.host.descriptors(['shares.manage'])).toEqual([])
      expect(request.mock.calls.map(([path]) => path)).toEqual(['/capabilities'])
      await vi.advanceTimersByTimeAsync(1999); expect(attempts).toBe(1)
      await vi.advanceTimersByTimeAsync(1); expect(attempts).toBe(2)
      expect(request.mock.calls.map(([path]) => path)).toEqual(['/capabilities', '/capabilities', '/shares'])
      expect(f.host.descriptors(['shares.manage'])).toHaveLength(2)
      expect(f.host.descriptors(['personal'])).toEqual([])
    } finally { f.host.stop() }
  })
  it('does not make share requests while disabled and allows an explicit network recovery to recheck availability', async () => {
    vi.useFakeTimers()
    let available = false
    const request = vi.fn(async (path: string) => path === '/capabilities' ? { sharing: { available } } : { owned: [], joined: [] })
    const f = fixture(request)
    try {
      f.host.start(f.context); await vi.advanceTimersByTimeAsync(299999)
      expect(request.mock.calls.map(([path]) => path)).toEqual(['/capabilities'])
      expect(f.socket).not.toHaveBeenCalled(); expect(f.host.descriptors(['shares.manage'])).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(request.mock.calls.map(([path]) => path)).toEqual(['/capabilities', '/capabilities'])
      available = true; f.host.recover('NETWORK_ONLINE'); await vi.advanceTimersByTimeAsync(0)
      expect(request.mock.calls.map(([path]) => path)).toEqual(['/capabilities', '/capabilities', '/capabilities', '/shares'])
      expect(f.host.descriptors(['shares.manage'])).toHaveLength(2)
    } finally { f.host.stop() }
  })
  it('backs off repeated failures and cancels the retry on Stop', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => { throw Error('TEMPORARY_NETWORK') }), f = fixture(request)
    f.host.start(f.context); await vi.advanceTimersByTimeAsync(14000)
    expect(request).toHaveBeenCalledTimes(4) // start, 2s, 6s, 14s
    expect(f.host.descriptors(['shares.manage'])).toEqual([])
    f.host.stop(); await vi.advanceTimersByTimeAsync(300000)
    expect(request).toHaveBeenCalledTimes(4); expect(f.socket).not.toHaveBeenCalled()
  })
  it('does not let an old account capability response enable sharing in a replacement session', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    const old = vi.fn(() => new Promise((done) => { resolve = done })), next = vi.fn(async () => ({ sharing: { available: false } }))
    const f = fixture(old)
    try {
      f.host.start(f.context); await vi.advanceTimersByTimeAsync(0)
      f.host.start({ ...f.context, ownerAccountId: 'other_owner', api: { request: next } as unknown as RemoteApi })
      await vi.advanceTimersByTimeAsync(0)
      resolve({ sharing: { available: true } }); await vi.advanceTimersByTimeAsync(0)
      expect(f.host.descriptors(['shares.manage'])).toEqual([])
      expect(old).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(300000)
      expect(next).toHaveBeenCalledTimes(2); expect(f.socket).not.toHaveBeenCalled()
    } finally { f.host.stop() }
  })
})
