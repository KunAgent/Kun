import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Socket } from '@kun/remote-protocol'
import type { KunAccountState } from '../../shared/kun-account'
import { MobileLinkService, PEER_LIST_INTERVAL_MS, type LinkDependencies } from './service'
import { MobileLinkRecovery } from './recovery'

afterEach(() => vi.useRealTimers())
const host = '11111111-1111-4111-8111-111111111111'
const phone = '22222222-2222-4222-8222-222222222222'
const state: KunAccountState = { status: 'authenticated', error: null,
  user: { id: 'owner', name: 'Owner', email: 'owner@test.invalid', avatarUrl: null } }
function fixture() {
  const sockets: Socket[] = []
  let pong = true
  const request = vi.fn(async () => ({ ok: true, status: 200, body: '{"agents":[]}' }))
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    return Response.json(path.endsWith('/grants') ? { grants: [{ id: 'grant', controllerId: phone }] }
      : path.endsWith('/pairings') ? { pairings: [] }
        : path.endsWith('/relay-tickets') ? { url: 'wss://relay.test/ws', ticket: 'ticket' }
          : { ok: true })
  }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>
  const deps: LinkDependencies = { requireMembership: async () => {},
    account: { getState: async () => state, accessToken: async () => 'token',
      expire: async () => {}, onState: () => () => {} },
    identity: async () => ({ id: host, credential: 'a'.repeat(64) }),
    origin: 'https://relay.test', name: 'desktop', platform: 'macos', fetch: fetcher,
    socket: () => {
      const socket: Socket = { onopen: null, onmessage: null, onerror: null, onclose: null,
        close: vi.fn(() => socket.onclose?.()),
        send: vi.fn((raw) => {
          if (JSON.parse(raw).kind === 'ping' && pong)
            queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"pong"}' }))
        }) }
      sockets.push(socket)
      queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"hello"}' }))
      return socket
    },
    lease: async () => ({ runtimeToken: 'runtime', request }),
    diagnostic: vi.fn()
  }
  const service = new MobileLinkService(deps)
  return { service, sockets, fetcher, deps, request, pong: (value: boolean) => { pong = value } }
}
async function settle() { await vi.advanceTimersByTimeAsync(0) }
async function cleanup(f: ReturnType<typeof fixture>) {
  f.service.dispose()
  await settle()
}

describe('desktop mobile link under network disruption', () => {
  it('stops on a missing account token and recovers after explicit authorization repair', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let authorized = true
    f.deps.account.accessToken = async () => authorized ? 'token' : null
    try {
      await f.service.enable(true); await settle()
      authorized = false
      await vi.advanceTimersByTimeAsync(20000)
      expect(f.sockets[0].close).toHaveBeenCalledOnce()
      expect(f.deps.diagnostic).toHaveBeenCalledWith('AUTHORIZATION_REJECTED', undefined)
      f.service.reconnect('NETWORK_ONLINE')
      await vi.advanceTimersByTimeAsync(120000)
      expect(f.sockets).toHaveLength(1)
      authorized = true
      await f.service.enable(false)
      await f.service.enable(true); await settle()
      expect(f.sockets).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(11000)
      expect((f.service as any).online).toBe(true)
      expect(vi.mocked(f.sockets[1].send).mock.calls.some(([raw]) => JSON.parse(raw).kind === 'ping')).toBe(true)
    } finally { await cleanup(f) }
  })

  it('keeps healthy WSS through sustained interface churn and recovers a genuinely dead route', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let network = 'network-0'
    const recovery = new MobileLinkRecovery({ online: () => true, network: () => network,
      power: () => () => {}, suspend: () => f.service.suspend(),
      reconnect: (reason) => f.service.reconnect(reason) })
    try {
      await f.service.enable(true)
      await settle()
      const original = f.sockets[0]
      for (let i = 1; i <= 20; i++) {
        network = 'debug-interface-' + i
        await vi.advanceTimersByTimeAsync(5000)
      }
      expect(f.sockets).toHaveLength(1)
      expect(original.close).not.toHaveBeenCalled()
      expect((f.service as any).online).toBe(true)
      expect(f.deps.diagnostic).toHaveBeenCalledWith('NETWORK_HINT_CHECK')
      f.pong(false)
      network = 'real-route-loss'
      await vi.advanceTimersByTimeAsync(22000)
      expect(original.close).toHaveBeenCalled()
      expect(f.sockets.length).toBeGreaterThan(1)
      f.pong(true)
      await settle()
      expect((f.service as any).online).toBe(true)
    } finally { recovery.dispose(); await cleanup(f) }
  })

  it('emits one bounded global resync to current authorized peers after a fast host reconnect', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true)
      await settle()
      const previous = f.sockets[0]
      previous.onclose?.({ code: 1006 })
      await vi.advanceTimersByTimeAsync(1500)
      expect(f.sockets).toHaveLength(2)
      const current = f.sockets[1]
      await vi.advanceTimersByTimeAsync(100)
      const resync = vi.mocked(current.send).mock.calls.map(([raw]) => JSON.parse(raw))
        .filter((frame) => frame.kind === 'resync_required')
      expect(resync).toHaveLength(1)
      expect(resync[0]).toMatchObject({ dst: phone, payload: { reason: 'host_reconnected' } })
      expect(resync[0].payload.resource).toBeUndefined()
      expect(resync[0].id).toMatch(/^[a-f0-9-]{36}$/)
      current.onmessage?.({ data: '{"v":1,"kind":"hello"}' })
      await vi.advanceTimersByTimeAsync(100)
      expect(vi.mocked(current.send).mock.calls.map(([raw]) => JSON.parse(raw))
        .filter((frame) => frame.kind === 'resync_required')).toHaveLength(1)
      const original = f.fetcher.getMockImplementation()!
      f.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/grants')
        ? Response.json({ grants: [] }) : original(input, init))
      f.service.reconnect('HOST_RESUMED')
      await vi.advanceTimersByTimeAsync(100)
      expect(f.sockets).toHaveLength(3)
      expect(vi.mocked(f.sockets[2].send).mock.calls.map(([raw]) => JSON.parse(raw))
        .filter((frame) => frame.kind === 'resync_required')).toHaveLength(0)
      expect(f.request).not.toHaveBeenCalled()
    } finally { await cleanup(f) }
  })

  it('ignores an OS online hint while healthy and uses it to recover an offline transport', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true)
      await settle()
      const socket = f.sockets[0]
      f.service.reconnect('NETWORK_ONLINE')
      await settle()
      expect(socket.close).not.toHaveBeenCalled()
      expect(f.sockets).toHaveLength(1)
      socket.onerror?.(new Error('network unavailable'))
      f.service.reconnect('NETWORK_ONLINE')
      await settle()
      expect(f.sockets).toHaveLength(2)
      expect((f.service as any).online).toBe(true)
    } finally { await cleanup(f) }
  })

  it('renews the authorization lease without waiting for slow peer metadata', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true)
      await settle()
      const socket = f.sockets[0], original = f.fetcher.getMockImplementation()!
      f.fetcher.mockImplementation(async (input, init) => {
        if (String(input).endsWith('/grants')) return new Promise<Response>(() => {})
        return original(input, init)
      })
      f.fetcher.mockClear()
      await vi.advanceTimersByTimeAsync(PEER_LIST_INTERVAL_MS + 11000)
      expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/relay-lease'))).toBe(true)
      expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/grants'))).toBe(true)
      expect(socket.close).not.toHaveBeenCalled()
      expect((f.service as any).authorizationExpiresAt).toBeGreaterThan(Date.now() + 20000)
      await vi.advanceTimersByTimeAsync(15000)
      expect(socket.close).not.toHaveBeenCalled()
      expect(f.deps.diagnostic).toHaveBeenCalledWith('PEER_METADATA_REFRESH_FAILED')
    } finally { await cleanup(f) }
  })

  it('keeps a renewed socket connected when an optional grant refresh fails', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true)
      await settle()
      const original = f.fetcher.getMockImplementation()!
      f.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/grants')
        ? Response.json({ error: 'data_unavailable' }, { status: 503 }) : original(input, init))
      await vi.advanceTimersByTimeAsync(PEER_LIST_INTERVAL_MS + 21000)
      expect(f.sockets[0].close).not.toHaveBeenCalled()
      expect((f.service as any).online).toBe(true)
      expect(f.deps.diagnostic).toHaveBeenCalledWith('PEER_METADATA_REFRESH_FAILED')
    } finally { await cleanup(f) }
  })

  it('lists grants on every connection but only every five minutes across lease renewals', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true)
      await settle()
      const count = (suffix: string) => f.fetcher.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length
      const renewals = count('/relay-lease'), listings = count('/grants')
      await vi.advanceTimersByTimeAsync(2 * PEER_LIST_INTERVAL_MS)
      // 30 renewals in ten minutes used to list grants 30 times.
      expect(count('/relay-lease') - renewals).toBe(30)
      expect(count('/grants') - listings).toBe(2)
      expect(f.sockets[0].close).not.toHaveBeenCalled()
      f.service.reconnect('HOST_RESUMED')
      await settle()
      expect(f.sockets).toHaveLength(2)
      expect(count('/grants') - listings).toBe(3)
    } finally { await cleanup(f) }
  })

  it('suspends and recovers the transport without disabling access or losing the grant', async () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      await f.service.enable(true)
      await settle()
      const old = f.sockets[0]
      f.fetcher.mockClear()
      f.service.suspend()
      expect((f.service as any).online).toBe(false)
      expect((f.service as any).authorizationExpiresAt).toBe(0)
      f.service.reconnect('HOST_RESUMED')
      await settle()
      expect(f.sockets).toHaveLength(2)
      expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/devices/enabled'))).toBe(false)
      const invoke = JSON.stringify({ v: 1, kind: 'invoke', id: 'r', src: phone,
        payload: { method: 'agent.list', requestId: 'r', expiresAt: Date.now() + 60000, params: {} } })
      old.onmessage?.({ data: invoke })
      await settle()
      expect(f.request).not.toHaveBeenCalled()
      f.sockets[1].onmessage?.({ data: invoke })
      await settle()
      expect(f.request).toHaveBeenCalledOnce()
      expect((await f.service.status()).enabled).toBe(true)
      await f.service.enable(false)
      f.service.reconnect('HOST_RESUMED')
      await settle()
      expect(f.sockets).toHaveLength(2)
    } finally { await cleanup(f) }
  })

  it('does not let a late renewal overwrite the replacement connection lease', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: (response: Response) => void
    try {
      await f.service.enable(true)
      await settle()
      const original = f.fetcher.getMockImplementation()!
      f.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/relay-lease')
        ? new Promise<Response>((resolve) => { release = resolve }) : original(input, init))
      await vi.advanceTimersByTimeAsync(31000)
      await vi.advanceTimersByTimeAsync(1000)
      f.service.reconnect('HOST_RESUMED')
      await settle()
      expect(f.sockets).toHaveLength(2)
      const deadline = (f.service as any).authorizationExpiresAt
      release(Response.json({ ok: true }))
      await settle()
      expect((f.service as any).authorizationExpiresAt).toBe(deadline)
      expect((f.service as any).online).toBe(true)
    } finally { await cleanup(f) }
  })

  it('coalesces overlapping panel status requests instead of duplicating metadata traffic', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: (response: Response) => void
    try {
      await f.service.enable(true)
      await settle()
      const original = f.fetcher.getMockImplementation()!
      f.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/pairings')
        ? new Promise<Response>((resolve) => { release = resolve }) : original(input, init))
      f.fetcher.mockClear()
      const first = f.service.status(), second = f.service.status()
      expect(first).toBe(second)
      await settle()
      expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/pairings'))).toHaveLength(1)
      expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/grants'))).toHaveLength(1)
      release(Response.json({ pairings: [] }))
      await Promise.all([first, second])
    } finally { await cleanup(f) }
  })

  it('does not let an old panel poll delay a freshly confirmed authorization', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let release!: (response: Response) => void, hold = true
    try {
      await f.service.enable(true)
      await settle()
      const original = f.fetcher.getMockImplementation()!
      f.fetcher.mockImplementation(async (input, init) => {
        if (String(input).endsWith('/pairings') && hold) {
          hold = false
          return new Promise<Response>((resolve) => { release = resolve })
        }
        return original(input, init)
      })
      f.fetcher.mockClear()
      const older = f.service.status()
      await settle()
      let confirmed = false
      const confirmation = f.service.confirm('44444444-4444-4444-8444-444444444444')
        .then(() => { confirmed = true })
      await settle()
      expect(confirmed).toBe(true)
      expect(f.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/pairings'))).toHaveLength(2)
      release(Response.json({ pairings: [] }))
      await Promise.all([older, confirmation])
    } finally { await cleanup(f) }
  })
})
