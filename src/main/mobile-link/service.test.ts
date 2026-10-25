import { describe, it, expect, vi } from 'vitest'
import { MobileLinkService, type LinkDependencies } from './service'
import { LIMITS, encodeFrames, type Socket } from '@kun/remote-protocol'
import type { KunAccountState } from '../../shared/kun-account'
import type { AccountSessionEnding } from '../art-assets/account-access'
const owner = 'account',
  controller = '22222222-2222-4222-8222-222222222222',
  grantId = '33333333-3333-4333-8333-333333333333'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function fixture() {
  let grants = [{ id: grantId, controllerId: controller }]
  let accountState: KunAccountState = {
    status: 'authenticated',
    user: { id: owner, name: 'owner', email: 'a@b.test', avatarUrl: null },
    error: null
  }
  let listener: (state: KunAccountState) => void = () => {},
    ending: (session: AccountSessionEnding) => Promise<void> = async () => {},
    socket: Socket
  const request = vi.fn(async (_path?: string, _method?: string, _body?: string) => ({
    ok: true,
    status: 200,
    body: JSON.stringify({
      receipt: { status: 'applied', result: { ok: true } }
    })
  }))
  const deps: LinkDependencies = { requireMembership: async () => {},
    account: {
      getState: async () => accountState,
      accessToken: async () => 'token',
      expire: async () => {},
      onState: (fn) => {
        listener = fn
        return () => {}
      },
      onSessionEnding: (fn) => {
        ending = fn
        return () => {}
      }
    },
    identity: vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      credential: 'a'.repeat(64)
    })),
    origin: 'https://relay.test',
    name: 'host',
    platform: 'macos',
    fetch: vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/confirm')) grants = [{ id: grantId, controllerId: controller }]
      if (path.endsWith('/grants/' + grantId) && init?.method === 'DELETE') grants = []
      return Response.json(
        path.endsWith('/grants')
          ? { grants }
          : path.endsWith('/pairings')
            ? { pairings: [{ id: '44444444-4444-4444-8444-444444444444', controllerId: controller, name: 'phone' }] }
            : path.endsWith('/relay-tickets')
              ? { url: 'wss://relay.test/ws', ticket: 'ticket' }
              : { ok: true }
      )
    }) as typeof fetch,
    socket: vi.fn(
      () =>
        (socket = {
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send: vi.fn(),
          close: vi.fn(() => socket.onclose?.())
        })
    ),
    lease: async () => ({ runtimeToken: 'runtime', request })
  }
  return {
    deps,
    request,
    setGrants: (value: typeof grants) => { grants = value },
    end: (session: AccountSessionEnding = { userId: owner, accessToken: 'token' }) => ending(session),
    get socket() {
      return socket
    },
    change: (
      next: KunAccountState = { status: 'anonymous', user: null, error: null }
    ) => {
      accountState = next
      listener(next)
    }
  }
}
describe('desktop phone boundary', () => {
  it('starts off, requires an explicit start after login, and stays off after restart', async () => {
    const f = fixture()
    f.change()
    let service = new MobileLinkService(f.deps)
    try {
      expect((await service.status()).enabled).toBe(false)
      await expect(service.enable(true)).rejects.toThrow('LOGIN_REQUIRED')
      expect(f.deps.identity).not.toHaveBeenCalled()
      expect(f.deps.fetch).not.toHaveBeenCalled()
      f.change({
        status: 'authenticated',
        error: null,
        user: { id: owner, name: 'owner', email: 'a@b.test', avatarUrl: null }
      })
      expect((await service.status()).enabled).toBe(false)
      expect(f.deps.socket).not.toHaveBeenCalled()
      expect(f.deps.fetch).not.toHaveBeenCalled()
      await service.enable(true)
      await tick()
      expect((await service.status()).enabled).toBe(true)
      expect(f.deps.socket).toHaveBeenCalledTimes(1)
      service.dispose()
      await tick()
      vi.mocked(f.deps.fetch).mockClear()
      service = new MobileLinkService(f.deps)
      expect((await service.status()).enabled).toBe(false)
      expect(f.deps.fetch).not.toHaveBeenCalled()
      expect(f.deps.socket).toHaveBeenCalledTimes(1)
    } finally {
      service.dispose()
    }
  })
  it('manual stop closes the relay and does not restart when account state refreshes', async () => {
    const f = fixture(),
      service = new MobileLinkService(f.deps)
    try {
      await service.enable(true)
      await tick()
      const socket = f.socket
      const state = await f.deps.account.getState()
      await service.enable(false)
      expect(socket.close).toHaveBeenCalled()
      expect(f.deps.fetch).toHaveBeenCalledWith(
        'https://relay.test/api/remote/v1/devices/enabled',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: false })
        })
      )
      f.change(state)
      await tick()
      expect((await service.status()).enabled).toBe(false)
      expect(f.deps.socket).toHaveBeenCalledTimes(1)
    } finally {
      service.dispose()
    }
  })
  it('logout during a pending identity check cannot activate a stale account', async () => {
    const f = fixture(),
      signedIn = await f.deps.account.getState()
    let resolve!: (state: KunAccountState) => void
    f.deps.account.getState = () =>
      new Promise((done) => {
        resolve = done
      })
    const service = new MobileLinkService(f.deps)
    try {
      const start = service.enable(true)
      const rejected = expect(start).rejects.toThrow('ACCOUNT_CHANGED')
      await tick()
      f.change()
      resolve(signedIn)
      await rejected
      expect(f.deps.fetch).not.toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
    } finally {
      service.dispose()
    }
  })
  it('ignores callers without a grant', async () => {
    const f = fixture(),
      service = new MobileLinkService(f.deps)
    try {
      await service.enable(true)
      await tick()
      f.socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello' }) })
      f.socket.onmessage?.({
        data: JSON.stringify({
          v: 1,
          kind: 'invoke',
          id: 'r',
          src: 'ungranted',
          payload: {
            method: 'catalog.get',
            requestId: 'r',
            expiresAt: Date.now() + 60000,
            params: {}
          }
        })
      })
      await tick()
      expect(f.request).not.toHaveBeenCalled()
    } finally {
      service.dispose()
    }
  })
  it('an account switch fences admission while a runtime lease is still being acquired', async () => {
    const f = fixture()
    let release: (value: any) => void = () => {}
    f.deps.lease = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const service = new MobileLinkService(f.deps)
    try {
      await service.enable(true)
      await tick()
      f.socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello' }) })
      f.socket.onmessage?.({
        data: JSON.stringify({
          v: 1,
          kind: 'invoke',
          id: 'r',
          src: controller,
          payload: {
            method: 'code.turn.start',
            requestId: 'r',
            expiresAt: Date.now() + 60000,
            params: { threadId: 't', text: 'work' }
          }
        })
      })
      await tick()
      f.change()
      expect(f.socket.close).toHaveBeenCalled()
      release({ runtimeToken: 'runtime', request: f.request })
      await tick()
      expect(f.request).not.toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
    } finally {
      service.dispose()
    }
  })
  it('fences the local connection immediately and disables with the ending account token', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    try {
      await service.enable(true)
      await tick()
      const socket = f.socket
      vi.mocked(f.deps.fetch).mockClear()
      f.deps.account.accessToken = async () => 'new-account-token'
      const cleanup = f.end({ userId: owner, accessToken: 'old-account-token' })
      expect(socket.close).toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
      await cleanup
      expect(f.deps.fetch).toHaveBeenCalledWith(
        'https://relay.test/api/remote/v1/devices/enabled',
        expect.objectContaining({
          method: 'PUT', body: JSON.stringify({ enabled: false }),
          headers: expect.objectContaining({ Authorization: 'Bearer old-account-token' })
        })
      )
      f.change()
      expect((await service.status()).enabled).toBe(false)
    } finally { service.dispose() }
  })
  it('revokes old grants before re-enabling after cleanup failed offline', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    try {
      await service.enable(true)
      await tick()
      vi.mocked(f.deps.fetch).mockRejectedValueOnce(new Error('offline'))
      await f.end()
      expect((await service.status()).enabled).toBe(false)
      f.change()
      f.change({ status: 'authenticated', error: null,
        user: { id: owner, name: 'owner', email: 'a@b.test', avatarUrl: null } })
      vi.mocked(f.deps.fetch).mockClear()
      await service.enable(true)
      await tick()
      const updates = vi.mocked(f.deps.fetch).mock.calls
        .filter(([url]) => String(url).endsWith('/devices/enabled'))
        .map(([, init]) => JSON.parse(String(init?.body)))
      expect(updates).toEqual([{ enabled: false }, { enabled: true }])
      const calls = vi.mocked(f.deps.fetch).mock.calls.map(([url]) => String(url))
      expect(calls.indexOf('https://relay.test/api/remote/v1/relay-tickets'))
        .toBeGreaterThan(calls.lastIndexOf('https://relay.test/api/remote/v1/devices/enabled'))
    } finally { service.dispose() }
  })
  it('resumes a remembered start with its grants and quits without revoking them', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    const updates = () => vi.mocked(f.deps.fetch).mock.calls
      .filter(([url]) => String(url).endsWith('/devices/enabled'))
      .map(([, init]) => JSON.parse(String(init?.body)))
    try {
      await service.enable(true, true)
      await tick()
      expect(updates()).toEqual([{ enabled: true }])
      expect((await service.status()).enabled).toBe(true)
      const socket = f.socket
      service.dispose(true)
      await tick()
      expect(socket.close).toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
      expect(updates()).toEqual([{ enabled: true }])
    } finally { service.dispose() }
  })
  it('refuses to start when stale authorization cannot be invalidated', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    const original = f.deps.fetch
    f.deps.fetch = vi.fn(async (input, init) => {
      if (String(input).endsWith('/devices/enabled') && String(init?.body).includes('false'))
        throw new Error('offline')
      return original(input, init)
    }) as typeof fetch
    try {
      await expect(service.enable(true)).rejects.toThrow('offline')
      expect(f.deps.socket).not.toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
    } finally { service.dispose() }
  })
  it('cannot re-enable until the account publishes a new authenticated session', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    try {
      await service.enable(true)
      await tick()
      await f.end()
      vi.mocked(f.deps.fetch).mockClear()
      await expect(service.enable(true)).rejects.toThrow('ACCOUNT_CHANGED')
      expect(f.deps.fetch).not.toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
    } finally { service.dispose() }
  })
  it('disables again when an earlier enable completes after session cleanup', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    let release!: (response: Response) => void
    const original = f.deps.fetch
    f.deps.fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith('/devices/enabled') && String(init?.body).includes('true'))
        return new Promise<Response>((done) => { release = done })
      return original(url, init)
    }) as typeof fetch
    try {
      const starting = service.enable(true)
      const rejected = expect(starting).rejects.toThrow('ACCOUNT_CHANGED')
      await tick()
      await f.end()
      release(Response.json({ ok: true }))
      await rejected
      await tick()
      const updates = vi.mocked(f.deps.fetch).mock.calls
        .filter(([url]) => String(url).endsWith('/devices/enabled'))
        .map(([, init]) => JSON.parse(String(init?.body)))
      expect(updates.slice(0, 2)).toEqual([{ enabled: false }, { enabled: true }])
      expect(updates.slice(2).every((update) => update.enabled === false)).toBe(true)
      expect(updates.length).toBeGreaterThanOrEqual(4)
      expect(f.deps.socket).not.toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
    } finally { service.dispose() }
  })
  it('admits a newly confirmed phone immediately and fences it as soon as revoke starts', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    f.setGrants([])
    const invoke = () => f.socket.onmessage?.({ data: JSON.stringify({ v: 1,
      kind: 'invoke', id: 'r', src: controller,
      payload: { method: 'catalog.get', requestId: 'r', expiresAt: Date.now() + 60000, params: {} } }) })
    try {
      await service.enable(true)
      await tick()
      f.socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello' }) })
      invoke()
      await tick()
      expect(f.request).not.toHaveBeenCalled()
      await service.confirm('44444444-4444-4444-8444-444444444444')
      invoke()
      await tick()
      expect(f.request).toHaveBeenCalledOnce()
      const revoking = service.revoke(grantId)
      invoke()
      await revoking
      await tick()
      expect(f.request).toHaveBeenCalledOnce()
      await service.confirm('44444444-4444-4444-8444-444444444444')
      invoke()
      await tick()
      expect(f.request).toHaveBeenCalledTimes(2)
    } finally { service.dispose() }
  })
  it('does not restore a locally revoked phone from a delayed status response or failed cloud revoke', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    let release!: (response: Response) => void
    let delayed = false
    const original = f.deps.fetch
    try {
      await service.enable(true)
      await tick()
      f.socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello' }) })
      // Existing RemoteApi owns the original function; replace the mock behavior.
      vi.mocked(original).mockImplementation(async (url, init) => {
        if (String(url).endsWith('/grants/' + grantId) && init?.method === 'DELETE')
          throw new Error('offline')
        if (String(url).endsWith('/grants') && !delayed) {
          delayed = true
          return new Promise<Response>((done) => { release = done })
        }
        return Response.json(String(url).endsWith('/grants') ? { grants: [{ id: grantId, controllerId: controller }] }
          : String(url).endsWith('/pairings') ? { pairings: [] } : { ok: true })
      })
      const status = service.status()
      await tick()
      await expect(service.revoke(grantId)).rejects.toThrow('offline')
      release(Response.json({ grants: [{ id: grantId, controllerId: controller }] }))
      await status
      await service.status()
      f.socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'invoke', id: 'r', src: controller,
        payload: { method: 'catalog.get', requestId: 'r', expiresAt: Date.now() + 60000, params: {} } }) })
      await tick()
      expect(f.request).not.toHaveBeenCalled()
    } finally { service.dispose() }
  })
  it('cancels a stalled startup immediately even when fetch ignores abort', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    let resolve!: (response: Response) => void
    vi.mocked(f.deps.fetch).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
    try {
      const starting = service.enable(true)
      const rejected = expect(starting).rejects.toThrow('ACCOUNT_CHANGED')
      await tick()
      const cancelled = await service.enable(false)
      expect(cancelled).toMatchObject({ enabled: false, starting: false })
      await rejected
      expect(f.deps.socket).not.toHaveBeenCalled()
      resolve(Response.json({ ok: true }))
      await tick()
      expect((await service.status()).enabled).toBe(false)
    } finally { service.dispose() }
  })
  it('preserves control bytes when normal requests from two phones fill the relay budget', async () => {
    const f = fixture(), service = new MobileLinkService(f.deps)
    const second = '55555555-5555-4555-8555-555555555555'
    f.setGrants([{ id: grantId, controllerId: controller }, { id: 'g2', controllerId: second }])
    const releases: ((lease: any) => void)[] = []
    f.deps.lease = () => new Promise((resolve) => { releases.push(resolve) })
    const send = (peer: string, call: any) => {
      for (const frame of encodeFrames({ v: 1, kind: 'invoke', id: call.requestId, src: peer, payload: call }))
        f.socket.onmessage?.({ data: frame })
    }
    try {
      await service.enable(true)
      await tick()
      f.socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: 'hello' }) })
      const expiresAt = Date.now() + 60000
      const sizes = [3 * 1024 * 1024, 3 * 1024 * 1024, LIMITS.bytes - 6 * 1024 * 1024]
      for (let i = 0; i < sizes.length; i++) {
        const call = { method: 'catalog.get', requestId: 'large-' + i, expiresAt, params: { filler: '' } }
        call.params.filler = 'x'.repeat(sizes[i] - Buffer.byteLength(JSON.stringify(call)))
        send(i === 1 ? second : controller, call)
      }
      send(second, { method: 'execution.stop', requestId: 'stop', expiresAt,
        params: { threadId: 'thread', executionId: 'execution' } })
      await tick()
      for (const release of releases) release({ runtimeToken: 'runtime', request: f.request })
      await tick()
      const methods = f.request.mock.calls.map((call) => JSON.parse(String(call[2])).call.method)
      expect(methods).toEqual(['catalog.get', 'catalog.get', 'execution.stop'])
      await expect.poll(() => vi.mocked(f.socket.send).mock.calls.some(([raw]) => {
        const frame = JSON.parse(raw)
        return frame.id === 'large-2' && frame.payload?.error?.code === 'BACKPRESSURE'
      })).toBe(true)
    } finally { service.dispose() }
  })
})
