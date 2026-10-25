import { afterEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_LIVE_CAPABILITY, READ_CONDITIONAL_CAPABILITY, type Socket } from '@kun/remote-protocol'
import { MobileLinkService, type LinkDependencies } from './service'

afterEach(() => vi.useRealTimers())
const host = '11111111-1111-4111-8111-111111111111', phone = '22222222-2222-4222-8222-222222222222'
function fixture(hello = '{"v":1,"kind":"hello"}') {
  const sockets: Socket[] = [], sent: any[] = []
  const request = vi.fn(async (_path: string, _method?: string, _body?: string) => ({ ok: true, status: 200,
    body: JSON.stringify({ host: { runtimeVersion: '1', confirmedAt: Date.now() }, capabilities: ['code'], capabilityDescriptors: [] }) }))
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    return Response.json(path.endsWith('/grants') ? { grants: [{ id: 'grant', controllerId: phone }] }
      : path.endsWith('/pairings') ? { pairings: [] }
        : path.endsWith('/relay-tickets') ? { url: 'wss://relay.test/ws', ticket: 'ticket' }
          : path.endsWith('/relay-lease') ? { ok: true, expiresAt: Date.now() + 300000 } : { ok: true })
  }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>
  const deps: LinkDependencies = { requireMembership: async () => {},
    account: { getState: async () => ({ status: 'authenticated', error: null, user: { id: 'owner', name: 'Owner', email: 'o@test.invalid', avatarUrl: null } }),
      accessToken: async () => 'token', expire: async () => {}, onState: () => () => {} },
    identity: async () => ({ id: host, credential: 'a'.repeat(64) }),
    origin: 'https://relay.test', name: 'desktop', platform: 'macos', fetch: fetcher,
    socket: () => {
      const socket: Socket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: vi.fn(),
        send: vi.fn((raw) => {
          const frame = JSON.parse(raw); sent.push(frame)
          if (frame.kind === 'ping') queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"pong"}' }))
        }) }
      sockets.push(socket)
      queueMicrotask(() => socket.onmessage?.({ data: hello }))
      return socket
    },
    lease: async () => ({ runtimeToken: 'runtime', request } as any)
  }
  return { service: new MobileLinkService(deps), sockets, sent, fetcher, request,
    deliver: (frame: object) => sockets.at(-1)!.onmessage?.({ data: JSON.stringify({ v: 1, ...frame }) }) }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('desktop link with a feature-aware relay', () => {
  it('follows a five minute lease, renewing about every hundred seconds without dropping authorization', async () => {
    vi.useFakeTimers()
    const f = fixture(JSON.stringify({ v: 1, kind: 'hello', payload: { leaseExpiresAt: Date.now() + 300000, features: ['presence', 'authorization', 'lossy'] } }))
    try {
      await f.service.enable(true); await settle()
      expect((f.service as any).authorizationExpiresAt).toBeGreaterThan(Date.now() + 290000)
      const renewals = () => f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/relay-lease')).length
      await vi.advanceTimersByTimeAsync(99000); expect(renewals()).toBe(0)
      await vi.advanceTimersByTimeAsync(2000); expect(renewals()).toBe(1)
      await vi.advanceTimersByTimeAsync(400000)
      expect((f.service as any).online).toBe(true)
      expect(f.sockets).toHaveLength(1)
    } finally { f.service.dispose(); await settle() }
  })
  it('re-reads grants on an authorization notice and drops a departed phone’s streams', async () => {
    vi.useFakeTimers()
    const f = fixture(JSON.stringify({ v: 1, kind: 'hello', payload: { leaseExpiresAt: Date.now() + 60000, features: ['presence', 'authorization'] } }))
    try {
      await f.service.enable(true); await settle()
      const listings = () => f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/grants')).length, before = listings()
      f.deliver({ kind: 'event', payload: { relay: 'authorization' } }); await settle()
      expect(listings()).toBe(before + 1)
      const clear = vi.spyOn((f.service as any).subscriptions, 'clear')
      f.deliver({ kind: 'event', payload: { relay: 'presence', deviceId: phone, online: false } }); await settle()
      expect(clear).toHaveBeenCalledWith(phone)
    } finally { f.service.dispose(); await settle() }
  })
  it('advertises live history and answers an unchanged catalog read with a marker the runtime never sees', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true); await settle()
      const invoke = (id: string, ifVersion?: string) => f.deliver({ kind: 'invoke', id, src: phone,
        payload: { method: 'catalog.get', requestId: id, expiresAt: Date.now() + 60000, params: {}, ...(ifVersion === undefined ? {} : { ifVersion }) } })
      const result = (id: string) => f.sent.find((frame) => frame.kind === 'result' && frame.id === id)?.payload
      invoke('first', ''); await vi.advanceTimersByTimeAsync(20)
      const first = result('first')
      expect(first.capabilities).toEqual(['code', READ_CONDITIONAL_CAPABILITY, HISTORY_LIVE_CAPABILITY])
      expect(typeof first.readVersion).toBe('string')
      await vi.advanceTimersByTimeAsync(5000)
      invoke('second', first.readVersion); await vi.advanceTimersByTimeAsync(20)
      expect(result('second')).toEqual({ readUnchanged: true, readVersion: first.readVersion })
      for (const [, , body] of f.request.mock.calls) expect(JSON.parse(body!).call).not.toHaveProperty('ifVersion')
    } finally { f.service.dispose(); await settle() }
  })
})
