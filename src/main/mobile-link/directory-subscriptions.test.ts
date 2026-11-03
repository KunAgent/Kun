import { describe, expect, it, vi } from 'vitest'
import { MobileSubscriptions } from './subscriptions'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const input = { kind: 'directory', id: 'all' }
const authority = (deviceId: string, scopes = ['personal']) => ({ accountId: 'owner', deviceId, authorizationId: 'grant', scopes })
function fixture() {
  const writers = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
  const cancelled = vi.fn(), send = vi.fn()
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    const device = new Headers(init?.headers).get('X-Kun-Remote-Device')!
    return new Response(new ReadableStream<Uint8Array>({ start: (writer) => writers.set(device, writer), cancel: () => cancelled(device) }))
  })
  const service = new MobileSubscriptions({ send, fetch: fetcher as typeof fetch,
    lease: async () => ({ baseUrl: 'http://runtime', runtimeToken: 'runtime', request: vi.fn() }) })
  const push = (device: string, value: unknown) => writers.get(device)!.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n'))
  return { service, send, fetcher, cancelled, push, writers }
}

describe('App directory subscription', () => {
  it('requires explicit opt-in and authority and forwards only metadata permitted for that phone', async () => {
    const f = fixture()
    await expect(f.service.subscribe('phone', input)).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
    await expect(f.service.subscribe('phone', { ...input, id: 'private' }, authority('phone'))).rejects.toThrow('INVALID_SUBSCRIPTION')
    expect(f.fetcher).not.toHaveBeenCalled()
    const watching = f.service.subscribe('phone', input, authority('phone'))
    await tick()
    expect(f.fetcher).toHaveBeenCalledWith('http://runtime/v1/remote/directory-events', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Kun-Remote-Authorization': 'grant', 'X-Kun-Remote-Scopes': 'personal' }) }))
    f.push('phone', { kind: 'synchronized', resources: ['agent', 'code', 'project', 'group'] })
    f.push('phone', { kind: 'directory_changed', resources: ['agent', 'group', 'unknown'], secret: 'must not be relayed' })
    await tick()
    expect(f.send.mock.calls.map(([frame]) => frame.payload)).toEqual([
      { resource: 'directory', resourceId: 'all', kind: 'subscribed', resources: ['agent', 'code', 'project'] },
      { resource: 'directory', resourceId: 'all', kind: 'directory_changed', resources: ['agent'] }
    ])
    f.service.clear(); await watching
    expect(f.cancelled).toHaveBeenCalledOnce()
    expect(f.send).toHaveBeenCalledTimes(2)
  })

  it('isolates subscribers and cancels pending reads immediately on unsubscribe or disconnect', async () => {
    const f = fixture()
    const first = f.service.subscribe('first', input, authority('first'))
    const second = f.service.subscribe('second', input, authority('second', ['personal', 'groups.read']))
    await tick()
    for (const device of ['first', 'second']) f.push(device, { kind: 'synchronized', resources: ['agent', 'group'] })
    await tick()
    await f.service.subscribe('first', { ...input, active: false }, authority('first'))
    await first
    expect(f.cancelled.mock.calls).toEqual([['first']])
    f.push('second', { kind: 'directory_changed', resources: ['group'] })
    await tick()
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ dst: 'second', payload: {
      resource: 'directory', resourceId: 'all', kind: 'directory_changed', resources: ['group'] } }))
    f.service.clear(); await second
    expect(f.cancelled.mock.calls).toEqual([['first'], ['second']])
    expect(f.send.mock.calls.some(([frame]) => frame.kind === 'resync_required')).toBe(false)
  })

  it('requests a fresh snapshot after runtime stream loss and suppresses a late response after fencing', async () => {
    const f = fixture(), watching = f.service.subscribe('phone', input, authority('phone'))
    await tick(); f.writers.get('phone')!.close(); await watching
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resync_required', payload: { resource: 'directory', resourceId: 'all' } }))
    let resolve!: (response: Response) => void
    f.fetcher.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
    f.send.mockClear()
    const late = f.service.subscribe('phone', input, authority('phone'))
    await tick(); f.service.clear()
    resolve(new Response('data: {"kind":"synchronized","resources":["agent"]}\n\n'))
    await late
    expect(f.send).not.toHaveBeenCalled()
  })
})
