import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteApi, RequestBudget, type Socket } from '@kun/remote-protocol'
import { MobileShareHosts } from './share-host'
import { EVENT_FRAME_SPACING_MS } from './event-coalescer'
import { shareFixture } from '../../../kun/src/remote/sharing/guest.test-support'
import { registerSharedTaskRoutes } from '../../../kun/src/remote/sharing/routes'
afterEach(() => vi.useRealTimers())
async function fixture() {
  const f = await shareFixture(); registerSharedTaskRoutes(f.router, f.runtime)
  const sockets: Socket[] = [], frames: any[] = [], calls: string[] = []
  let current = true, blockAdmit: Promise<void> | undefined, beforeInvoke: Promise<void> | undefined, afterInvoke: Promise<void> | undefined, afterResource: Promise<void> | undefined
  const runtimeRequest = async (path: string, _method?: string, body?: string) => {
    calls.push(path)
    if (path.endsWith('/guest-admit') && blockAdmit) await blockAdmit
    if (path.endsWith('/guest-invoke') && beforeInvoke) await beforeInvoke
    const route = f.router.match('POST', path)!
    const response = await route.handler(new Request('http://runtime' + path, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body }), { params: route.params })
    if (path.endsWith('/guest-invoke') && afterInvoke) await afterInvoke
    if (path.endsWith('/resource') && afterResource) await afterResource
    return response instanceof Response ? { ok: response.ok, status: response.status, body: await response.text() } : {
      ok: response.status < 400, status: response.status, body: response.body }
  }
  const hostLease = () => ({ shareId: 'share', ownerAccountId: 'owner', hostDeviceId: 'host', resourceHandle: f.share.resourceHandle,
    shareVersion: 1, userId: 'owner', deviceId: 'host', role: 'host', mode: 'write', expiresAt: Date.now() + 60000,
    peers: [{ deviceId: 'guestphone', accountId: 'guest', memberId: 'member', memberVersion: 1, mode: 'write' }] })
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname
    if (url.hostname === 'runtime') {
      const route = f.router.match('POST', path)!
      return await route.handler(new Request(url, init), { params: route.params }) as Response
    }
    if (path.endsWith('/capabilities')) return Response.json({ sharing: { available: true } })
    if (path.endsWith('/relay-tickets')) return Response.json({ ticket: 'share-ticket', url: 'wss://relay.test/api/remote/v1/shares/share/ws' })
    if (path.endsWith('/relay-lease')) return Response.json({ ok: true, share: hostLease() })
    if (path.endsWith('/shares/share')) return Response.json({ share: f.share, members: [] })
    return Response.json({ owned: [f.share], joined: [] })
  }
  const api = new RemoteApi({ origin: 'https://relay.test', token: async () => 'test-owner-token',
    identity: async () => ({ id: 'host', credential: 'a'.repeat(64) }), fetch: fetcher })
  const deps = { origin: 'https://relay.test', fetch: fetcher, budget: new RequestBudget(), totalBudget: new RequestBudget(),
    lease: async () => ({ baseUrl: 'http://runtime', runtimeToken: 'token', request: runtimeRequest }),
    socket: () => {
      const socket: Socket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: vi.fn(), send: (raw) => {
        const frame = JSON.parse(raw); frames.push(frame)
        if (frame.kind === 'ping') queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"pong"}' }))
      } }; sockets.push(socket); return socket
    } }
  const host = new MobileShareHosts(deps)
  host.start({ api, ownerAccountId: 'owner', hostDeviceId: 'host', current: () => current })
  await vi.waitFor(() => expect(sockets.length).toBe(1))
  const hello = (socket = sockets.at(-1)!) => { const lease = hostLease(); socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello', payload: { version: 1, leaseExpiresAt: lease.expiresAt, share: lease } }) }) }
  const guestFrame = (kind: string, payload: unknown, id = 'read', socket = sockets.at(-1)!) => socket.onmessage?.({ data: JSON.stringify({ v: 1, kind, id,
    src: 'guestphone', dst: 'host', shared: { shareId: 'share', resourceHandle: f.share.resourceHandle, shareVersion: 1,
      accountId: 'guest', role: 'guest', memberId: 'member', memberVersion: 1, mode: 'write' }, payload }) })
  return { ...f, host, deps, sockets, frames, calls, hello, guestFrame,
    block: (value: Promise<void> | undefined) => { blockAdmit = value },
    delay: (kind: 'before' | 'after' | 'resource', value: Promise<void> | undefined) => { if (kind === 'before') beforeInvoke = value; else if (kind === 'after') afterInvoke = value; else afterResource = value },
    stop: () => { current = false; host.stop() }, close: async () => { current = false; host.stop(); await new Promise((r) => setTimeout(r, 10)); await f.close() } }
}
describe('independent Main ShareHost with real local Runtime and Manager store', () => {
  it('waits for local trusted admission, reads only the mapped task, and uses an independent socket', async () => {
    const f = await fixture()
    try {
      f.hello()
      await vi.waitFor(() => expect(f.frames.some((v) => v.kind === 'resync_required')).toBe(true))
      f.guestFrame('invoke', f.call('catalog.get', {}, 'bootstrap'), 'bootstrap')
      await vi.waitFor(() => expect(f.frames.find((v) => v.kind === 'result' && v.id === 'bootstrap')?.payload.threadId).toBe(f.task.id))
      expect(f.calls.filter((p) => p === '/v1/remote/invoke')).toEqual([])
      f.guestFrame('invoke', f.call('code.history', { threadId: f.other.id }, 'forbidden'), 'forbidden')
      await vi.waitFor(() => expect(f.frames.find((v) => v.kind === 'result' && v.id === 'forbidden')?.payload.error.code).toBe('SHARE_RESOURCE_NOT_ALLOWED'))
    } finally { await f.close() }
  })
  it('keeps a healthy subscription and the same authority through renewal', async () => {
    const f = await fixture()
    try {
      f.hello()
      await vi.waitFor(() => expect(f.frames.some((v) => v.kind === 'resync_required')).toBe(true))
      f.guestFrame('subscribe', { kind: 'code', id: f.task.id, since: 0 }, 'subscribe')
      await vi.waitFor(() => expect((f.host as any).connections.get('share').streams.size).toBe(1))
      const actor = (await f.store.list<any>('shared_actor', { taskId: 'share', limit: 10 })).find((r) => r.value.deviceId === 'guestphone')!
      vi.useFakeTimers()
      await vi.advanceTimersByTimeAsync(20010)
      expect(f.sockets).toHaveLength(1)
      expect((f.host as any).connections.get('share').streams.size).toBe(1)
      expect((await f.store.get<any>('shared_actor', actor.id))!.value).toMatchObject({ sessionId: actor.value.sessionId, active: true })
      expect(f.calls.filter((p) => p.endsWith('/guest-fence'))).toHaveLength(0)
    } finally { vi.useRealTimers(); await f.close() }
  })
  it('relays a burst of task events to a guest as at most one frame per spacing with the newest cursor', async () => {
    const f = await fixture()
    try {
      f.hello()
      await vi.waitFor(() => expect(f.frames.some((v) => v.kind === 'resync_required')).toBe(true))
      f.guestFrame('subscribe', { kind: 'code', id: f.task.id, since: 0 }, 'subscribe')
      await vi.waitFor(() => expect(f.frames.some((v) => v.kind === 'event' && v.payload?.kind === 'subscribed')).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 2 * EVENT_FRAME_SPACING_MS))
      const before = f.frames.length, cursors = () => f.frames.slice(before).filter((v) => v.kind === 'event').map((v) => v.payload.event.seq)
      // A streamed reply: one delta every 5 ms (a synchronous burst would trip the runtime's own slow-reader close).
      const started = Date.now()
      for (let seq = 1000; seq < 1060; seq++) {
        f.runtime.eventBus.publish({ kind: 'error', threadId: f.task.id, seq,
          timestamp: '2026-10-18T00:00:00.000Z', message: 'delta', code: 'test', severity: 'warning' })
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      await vi.waitFor(() => expect(cursors().at(-1)).toBe(1059))
      expect(cursors().length).toBeLessThanOrEqual(Math.floor((Date.now() - started) / EVENT_FRAME_SPACING_MS) + 1)
      expect(cursors()).toEqual([...cursors()].sort((a, b) => a - b))
    } finally { await f.close() }
  })
  it('persists a session tombstone before a delayed guest-admit finishes after Stop', async () => {
    const f = await fixture(); let release!: () => void
    try {
      f.block(new Promise<void>((resolve) => { release = resolve }))
      f.hello()
      await vi.waitFor(() => expect(f.calls.some((p) => p.endsWith('/guest-admit'))).toBe(true))
      const sessionId = (f.host as any).connections.get('share').sessionId
      f.stop()
      await vi.waitFor(() => expect(f.calls.some((p) => p.endsWith('/guest-fence'))).toBe(true))
      await vi.waitFor(async () => expect((await f.journal.resource(f.owner, f.share.resourceHandle))?.retiredSessions?.some((s) => s.id === sessionId)).toBe(true))
      release(); await new Promise((r) => setTimeout(r, 10))
      const row = (await f.store.list<any>('shared_actor', { taskId: 'share', limit: 10 })).find((r) => r.value.deviceId === 'guestphone')!
      expect(row.value.sessionId).not.toBe(sessionId)
      expect(f.frames.filter((v) => v.kind === 'result')).toEqual([])
    } finally { release?.(); f.block(undefined); await f.close() }
  })
  it.each(['before', 'after'] as const)('drops an old-session %s reply when the same SDK connection reconnects', async (phase) => {
    const f = await fixture(); let release!: () => void
    try {
      f.hello(); await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'resync_required')).toBe(true))
      f.delay(phase, new Promise<void>((resolve) => { release = resolve }))
      f.guestFrame('invoke', f.call('catalog.get', {}, 'old_reply'), 'old_reply')
      await vi.waitFor(() => expect(f.calls.some((path) => path.endsWith('/guest-invoke'))).toBe(true))
      const connection = (f.host as any).connections.get('share'), original = connection.sessionId
      connection.client.reconnect()
      await vi.waitFor(() => expect(f.sockets).toHaveLength(2))
      f.hello()
      await vi.waitFor(() => expect(f.frames.filter((frame) => frame.kind === 'resync_required')).toHaveLength(2))
      expect(connection.sessionId).not.toBe(original)
      release(); await new Promise((resolve) => setTimeout(resolve, 15))
      expect(f.frames.filter((frame) => frame.kind === 'result' && frame.id === 'old_reply')).toEqual([])
    } finally { release?.(); f.delay(phase, undefined); await f.close() }
  })
  it('does not establish an old-session subscription after resource lookup crosses a reconnect', async () => {
    const f = await fixture(); let release!: () => void
    try {
      f.hello(); await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'resync_required')).toBe(true))
      f.delay('resource', new Promise<void>((resolve) => { release = resolve }))
      f.guestFrame('subscribe', { kind: 'code', id: f.task.id, since: 0 }, 'late_subscribe')
      await vi.waitFor(() => expect(f.calls.some((path) => path.endsWith('/resource'))).toBe(true))
      const connection = (f.host as any).connections.get('share'); connection.client.reconnect()
      await vi.waitFor(() => expect(f.sockets).toHaveLength(2)); f.hello()
      await vi.waitFor(() => expect(f.frames.filter((frame) => frame.kind === 'resync_required')).toHaveLength(2))
      release(); await new Promise((resolve) => setTimeout(resolve, 15))
      expect(connection.streams.size).toBe(0)
    } finally { release?.(); f.delay('resource', undefined); await f.close() }
  })
  it('returns a definite unsent backpressure error before Runtime dispatch', async () => {
    const f = await fixture()
    try {
      f.hello(); await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'resync_required')).toBe(true))
      const releases = Array.from({ length: 62 }, () => f.deps.budget.reserve('guestphone', 1))
      try {
        f.guestFrame('invoke', f.call('code.turn.start', { threadId: f.task.id, text: 'not accepted' }, 'blocked'), 'blocked')
        await vi.waitFor(() => expect(f.frames.find((frame) => frame.id === 'blocked' && frame.kind === 'result')?.payload.error).toMatchObject({ code: 'BACKPRESSURE', uncertain: false }))
        expect(f.calls.filter((path) => path.endsWith('/guest-invoke'))).toEqual([])
      } finally { releases.forEach((release) => release()) }
    } finally { await f.close() }
  })

})
