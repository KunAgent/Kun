import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DIRECTORY_LIVE_CAPABILITY, encodeFrames, type Frame, type Socket } from '@kun/remote-protocol'
import { remoteFixture } from '../../../kun/src/remote/testing/runtime.test-support'
import { registerRemoteRoutes } from '../../../kun/src/remote/routes'
import { ThreadActivityRegistry } from '../../../kun/src/services/thread-activity-registry'
import { startNodeHttpServer } from '../../../kun/src/server/node-http-server'
import { DIRECTORY_SPACING_MS } from '../../../kun/src/remote/directory/feed'
import { MobileLinkService, type LinkDependencies } from './service'

const host = '11111111-1111-4111-8111-111111111111'
const phone = '22222222-2222-4222-8222-222222222222'
const grant = '33333333-3333-4333-8333-333333333333'

async function fixture(directory = true) {
  const runtime = await remoteFixture(), registry = new ThreadActivityRegistry()
  if (directory) { runtime.runtime.threadActivity = registry; runtime.h.events.addObserver(registry) }
  registerRemoteRoutes(runtime.router, runtime.runtime)
  const server = await startNodeHttpServer({ router: runtime.router, host: '127.0.0.1', port: 0 })
  const baseUrl = 'http://127.0.0.1:' + server.port
  const frames: Frame[] = [], streams: Headers[] = []
  let socket!: Socket
  const request: Awaited<ReturnType<LinkDependencies['lease']>>['request'] = async (path, method, body) => {
    const response = await fetch(baseUrl + path, { method, body,
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } })
    return { ok: response.ok, status: response.status, body: await response.text() }
  }
  const deps: LinkDependencies = { requireMembership: async () => {},
    account: { getState: async () => ({ status: 'authenticated', error: null,
      user: { id: 'owner', name: 'Owner', email: 'owner@test.invalid', avatarUrl: null } }),
    accessToken: async () => 'account-token', expire: async () => {}, onState: () => () => {} },
    identity: async () => ({ id: host, credential: 'a'.repeat(64) }),
    name: 'Host', platform: 'macos', origin: 'https://relay.test',
    lease: async () => ({ baseUrl, runtimeToken: 'token', request }),
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.origin === baseUrl) {
        if (url.pathname === '/v1/remote/directory-events') streams.push(new Headers(init?.headers))
        return fetch(input, init)
      }
      return Response.json(url.pathname.endsWith('/grants') ? { grants: [{ id: grant, controllerId: phone }] }
        : url.pathname.endsWith('/pairings') ? { pairings: [] }
          : url.pathname.endsWith('/relay-tickets') ? { url: 'wss://relay.test/ws', ticket: 'ticket' } : { ok: true })
    },
    socket: () => {
      socket = { onopen: null, onmessage: null, onclose: null, onerror: null,
        close: () => socket.onclose?.(), send: (raw) => frames.push(JSON.parse(raw) as Frame) }
      queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"hello"}' }))
      return socket
    }
  }
  const service = new MobileLinkService(deps)
  const send = (frame: Frame) => {
    for (const data of encodeFrames({ v: 1, src: phone, dst: host, ...frame })) socket.onmessage?.({ data })
  }
  const invoke = (method: string) => {
    const id = randomUUID()
    send({ kind: 'invoke', id, payload: { method, params: {}, requestId: id, expiresAt: Date.now() + 60000 } })
    return id
  }
  const subscribe = (active: boolean, src = phone) => send({ kind: 'subscribe', id: randomUUID(), src,
    payload: { kind: 'directory', id: 'all', active, scopes: ['groups.read'] } })
  const directoryFrames = () => frames.filter((frame) => frame.kind === 'event' && frame.payload?.resource === 'directory')
  return { ...runtime, registry, service, frames, streams, invoke, subscribe, directoryFrames,
    close: async () => { service.dispose(); await runtime.close(); await server.close() } }
}

it('carries serialized directory subscriptions through authenticated Runtime HTTP/SSE and back to the phone, then fences cancellation', async () => {
  const f = await fixture()
  try {
    const original = f.registry.subscribe.bind(f.registry), detached = vi.fn()
    vi.spyOn(f.registry, 'subscribe').mockImplementation((listener) => {
      const stop = original(listener)
      return () => { detached(); stop() }
    })
    await f.service.enable(true)
    await vi.waitFor(async () => expect((await f.service.status()).online).toBe(true))
    const catalog = f.invoke('catalog.get')
    await vi.waitFor(() => expect(f.frames.find((frame) => frame.id === catalog)?.payload.capabilities).toContain(DIRECTORY_LIVE_CAPABILITY))
    f.subscribe(true)
    await vi.waitFor(() => expect(f.directoryFrames()[0]?.payload.kind).toBe('subscribed'))
    expect(f.streams).toHaveLength(1)
    expect(f.streams[0].get('X-Kun-Remote-Device')).toBe(phone)
    expect(f.streams[0].get('X-Kun-Remote-Scopes')).toBe('personal')
    await f.code('Sensitive task title stays on the host')
    await vi.waitFor(() => expect(f.directoryFrames().at(-1)?.payload).toEqual({
      resource: 'directory', resourceId: 'all', kind: 'directory_changed', resources: ['code', 'project'] }))
    await f.rooms.service.create({ clientRequestId: 'group-create', name: 'Sensitive group contents' })
    await vi.waitFor(() => expect(f.directoryFrames().at(-1)?.payload).toEqual({
      resource: 'directory', resourceId: 'all', kind: 'directory_changed', resources: ['agent'] }))
    expect(JSON.stringify(f.directoryFrames())).not.toContain('Sensitive')

    f.subscribe(false)
    await vi.waitFor(() => expect(detached).toHaveBeenCalledOnce())
    const count = f.directoryFrames().length
    await f.code('Created after cancellation')
    f.subscribe(true, '44444444-4444-4444-8444-444444444444')
    await new Promise((resolve) => setTimeout(resolve, DIRECTORY_SPACING_MS + 50))
    expect(f.directoryFrames()).toHaveLength(count)
    expect(f.streams).toHaveLength(1)
  } finally { await f.close() }
})

it('does not advertise directory push for an older Runtime without the compact activity source', async () => {
  const f = await fixture(false)
  try {
    await f.service.enable(true)
    await vi.waitFor(async () => expect((await f.service.status()).online).toBe(true))
    const id = f.invoke('catalog.get')
    await vi.waitFor(() => expect(f.frames.some((frame) => frame.id === id && frame.kind === 'result')).toBe(true))
    expect(f.frames.find((frame) => frame.id === id)?.payload.capabilities).not.toContain(DIRECTORY_LIVE_CAPABILITY)
    expect(f.streams).toEqual([])
  } finally { await f.close() }
})
