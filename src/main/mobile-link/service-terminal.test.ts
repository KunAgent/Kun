import { describe, expect, it, vi } from 'vitest'
import type { Socket } from '@kun/remote-protocol'
import { MobileLinkService, type LinkDependencies } from './service'
import type { RemoteTerminalService, TerminalAuthority } from '../remote-terminal/session-service'

const phone = '22222222-2222-4222-8222-222222222222'
const host = '11111111-1111-4111-8111-111111111111'
const grant = '33333333-3333-4333-8333-333333333333'
const rotated = '66666666-6666-4666-8666-666666666666'
const pairing = '44444444-4444-4444-8444-444444444444'
const control = ['desktop.view', 'desktop.control']
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

type Recorded = { method: string; params: unknown; authority: TerminalAuthority }
type Ending = (session: { userId: string | null; accessToken: string | null }) => Promise<void>

/**
 * One host with one paired controller, a real MobileLinkService and a terminal-engine double that keeps the
 * TerminalAuthority the dispatcher hands it. Nothing here reaches the runtime: terminal calls are ephemeral.
 */
function fixture() {
  let grants = [{ id: grant, controllerId: phone }], socket!: Socket
  const sockets: Socket[] = [], frames: any[] = [], calls: any[] = [], recorded: Recorded[] = []
  let ending: Ending | undefined
  const request = vi.fn(async (_path: string, _method?: string, body?: string) => {
    if (body) calls.push(JSON.parse(body))
    return { ok: true, status: 200, body: '{"ok":true}' }
  })
  const terminal = {
    invoke: vi.fn(async (method: string, params: unknown, authority: TerminalAuthority) => {
      recorded.push({ method, params, authority })
      return method === 'terminal.open' ? { session: { sessionId: 'session-1' }, snapshot: '' } : { state: 'missing' }
    }),
    descriptors: vi.fn(() => []),
    capabilities: vi.fn(() => []),
    detachAll: vi.fn(),
    stopAll: vi.fn(async (_reason?: string) => {}),
    authorityChanged: vi.fn(),
    peerGone: vi.fn()
  }
  const deps: LinkDependencies = {
    requireMembership: async () => {},
    origin: 'https://relay.test', name: 'Host', platform: 'macos',
    account: {
      getState: async () => ({ status: 'authenticated', error: null,
        user: { id: 'owner', name: 'Owner', email: 'owner@test.invalid', avatarUrl: null } }),
      onState: () => () => {},
      onSessionEnding: (listener) => { ending = listener as Ending; return () => { ending = undefined } },
      accessToken: async () => 'token', expire: async () => {}
    },
    identity: async () => ({ id: host, credential: 'a'.repeat(64) }),
    lease: async () => ({ runtimeToken: 'runtime', request }),
    fetch: async (input) => {
      const path = new URL(String(input)).pathname
      return Response.json(path.endsWith('/grants') ? { grants } : path.endsWith('/pairings') ?
        { pairings: [{ id: pairing, controllerId: phone, name: 'Phone' }] } : path.endsWith('/relay-tickets') ?
          { url: 'wss://relay.test/ws', ticket: 'ticket' } : { ok: true })
    },
    socket: () => {
      const next: Socket = { onopen: null, onmessage: null, onerror: null, onclose: null,
        close: () => next.onclose?.(), send: (raw) => frames.push(JSON.parse(raw)) }
      socket = next; sockets.push(next); return next
    },
    terminal: terminal as unknown as RemoteTerminalService
  }
  const service = new MobileLinkService(deps)
  const hello = () => socket.onmessage?.({ data: '{"v":1,"kind":"hello"}' })
  const invoke = (method: string, params: unknown, id: string) => socket.onmessage?.({ data: JSON.stringify({ v: 1,
    kind: 'invoke', src: phone, id, payload: { method, params, requestId: id, expiresAt: Date.now() + 60000 } }) })
  // Starting the host always begins with an internal stop(); clear those calls so each test sees only its own.
  const start = async () => { await service.enable(true); await tick(); hello()
    terminal.stopAll.mockClear(); terminal.detachAll.mockClear() }
  /** Trusts the paired controller with both desktop scopes, which is what terminal operations require. */
  const grantControl = async () => { await service.confirm(pairing, control); terminal.authorityChanged.mockClear() }
  const open = async (id = 'open') => {
    const before = recorded.length
    invoke('terminal.open', { startId: 'start', origin: { kind: 'code', id: 'thread' } }, id)
    await vi.waitFor(() => expect(recorded.length).toBeGreaterThan(before))
    return recorded.at(-1)!
  }
  return { service, deps, terminal, sockets, frames, calls, recorded, hello, invoke, start, grantControl, open,
    grants: (value: typeof grants) => { grants = value }, ending: () => ending }
}

describe('terminal authority across socket transports', () => {
  it('hands the engine the grant authority of an authorized controller', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const call = await f.open()
      expect(call.method).toBe('terminal.open')
      expect(call.authority).toMatchObject({ accountId: 'owner', deviceId: phone })
      expect(call.authority.scopes).toEqual(expect.arrayContaining(['personal', 'desktop.view', 'desktop.control']))
      // A grant-stable identity, not a socket epoch: sha256 over the grant version.
      expect(call.authority.authorizationId).toMatch(/^[a-f0-9]{64}$/)
      expect(call.authority.current()).toBe(true)
      expect(call.authority.validForMs()).toBeGreaterThan(0)
      await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'result' && frame.id === 'open')).toBe(true))
    } finally { f.service.dispose(); await tick() }
  })

  it('detaches sessions and fences the captured authority on transport closure while its lease stays readable', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const first = (await f.open()).authority
      const detachBefore = f.terminal.detachAll.mock.calls.length
      const leaseAtClosure = first.validForMs()
      f.sockets.at(-1)!.onclose?.()
      await tick()
      expect(f.terminal.detachAll.mock.calls.length).toBe(detachBefore + 1)
      // A fence is not a stop: the engine keeps the session so the same grant can re-attach.
      expect(f.terminal.stopAll).not.toHaveBeenCalled()
      expect(first.current()).toBe(false)
      expect(first.validForMs()).toBeGreaterThan(0)
      expect(first.validForMs()).toBeLessThanOrEqual(leaseAtClosure)
      // A late event from the closed transport never reaches the phone.
      first.emit({ event: 'terminal.output', data: 'late' } as never)
      expect(f.frames.some((frame) => frame.kind === 'event' && frame.payload?.data === 'late')).toBe(false)
    } finally { f.service.dispose(); await tick() }
  })

  it('re-attaches the same grant on a new transport with the same identity but a fresh lease', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const first = (await f.open()).authority
      f.sockets.at(-1)!.onclose?.()
      await tick()
      const beforeReconnect = f.sockets.length
      f.service.reconnect('NETWORK_RECOVERY')
      await vi.waitFor(() => expect(f.sockets.length).toBeGreaterThan(beforeReconnect))
      f.hello(); await tick()
      const second = (await f.open('attach')).authority
      expect(second.authorizationId).toBe(first.authorizationId)
      expect(second.current()).toBe(true)
      expect(first.current()).toBe(false)
      expect(second.validForMs()).toBeGreaterThan(0)
      // The retained lease of the closed transport is never renewed by the new socket.
      expect(first.validForMs()).toBeLessThanOrEqual(second.validForMs())
    } finally { f.service.dispose(); await tick() }
  })
})

describe('terminal authority rotation and session end', () => {
  it('rotates the grant identity when scopes shrink and again when they are re-granted', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const first = (await f.open()).authority
      f.terminal.authorityChanged.mockClear()
      await f.service.setScopes(grant, [])
      expect(f.terminal.authorityChanged).toHaveBeenCalledWith(phone)
      expect(first.current()).toBe(false)
      // The phone keeps its socket but loses the terminal scopes: the call is refused before the engine sees it.
      f.invoke('terminal.open', { startId: 'start', origin: { kind: 'code', id: 'thread' } }, 'denied')
      await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'result' && frame.id === 'denied')).toBe(true))
      expect(f.frames.find((frame) => frame.id === 'denied')!.payload.error.code).toBe('REMOTE_SCOPE_REQUIRED')
      expect(f.terminal.invoke).toHaveBeenCalledTimes(1)
      f.terminal.authorityChanged.mockClear()
      await f.service.setScopes(grant, control)
      expect(f.terminal.authorityChanged).toHaveBeenCalledWith(phone)
      const second = (await f.open('again')).authority
      expect(second.authorizationId).not.toBe(first.authorizationId)
      expect(second.current()).toBe(true)
      expect(second.scopes).toEqual(expect.arrayContaining(['desktop.view', 'desktop.control']))
    } finally { f.service.dispose(); await tick() }
  })

  it('revoking the grant notifies the engine and stops authorizing it', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const first = (await f.open()).authority
      f.terminal.authorityChanged.mockClear()
      await f.service.revoke(grant)
      expect(f.terminal.authorityChanged).toHaveBeenCalledWith(phone)
      expect(first.current()).toBe(false)
      f.invoke('terminal.open', { startId: 'start', origin: { kind: 'code', id: 'thread' } }, 'revoked')
      await tick(); await tick()
      expect(f.terminal.invoke).toHaveBeenCalledTimes(1)
      expect(f.frames.some((frame) => frame.id === 'revoked')).toBe(false)
    } finally { f.service.dispose(); await tick() }
  })

  it('treats a replaced grant as a new identity and drops the old scopes', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const first = (await f.open()).authority
      f.terminal.authorityChanged.mockClear()
      f.grants([{ id: rotated, controllerId: phone }])
      await f.service.status()
      expect(f.terminal.authorityChanged).toHaveBeenCalledWith(phone)
      expect(first.current()).toBe(false)
      f.invoke('terminal.open', { startId: 'start', origin: { kind: 'code', id: 'thread' } }, 'rotated')
      await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'result' && frame.id === 'rotated')).toBe(true))
      expect(f.frames.find((frame) => frame.id === 'rotated')!.payload.error.code).toBe('REMOTE_SCOPE_REQUIRED')
      expect(f.terminal.invoke).toHaveBeenCalledTimes(1)
    } finally { f.service.dispose(); await tick() }
  })

  it('stops every retained terminal and fences the last authority when the account session ends', async () => {
    const f = fixture()
    try {
      await f.start(); await f.grantControl()
      const first = (await f.open()).authority
      const ending = f.ending()
      expect(ending).toBeTypeOf('function')
      await ending!({ userId: 'owner', accessToken: 'token' })
      await tick()
      expect(f.terminal.stopAll).toHaveBeenCalledWith('host_stopped')
      expect(first.current()).toBe(false)
      expect(f.terminal.detachAll).not.toHaveBeenCalled()
    } finally { f.service.dispose(); await tick() }
  })
})
