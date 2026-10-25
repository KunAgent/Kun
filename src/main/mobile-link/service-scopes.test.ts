import { describe, expect, it, vi } from 'vitest'
import type { Socket } from '@kun/remote-protocol'
import { MobileLinkService, type LinkDependencies } from './service'
const phone = '22222222-2222-4222-8222-222222222222', grant = '33333333-3333-4333-8333-333333333333'
const pairing = '44444444-4444-4444-8444-444444444444'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function fixture() {
  let grants = [{ id: grant, controllerId: phone }], socket!: Socket
  const frames: any[] = [], calls: any[] = []
  let response: (() => Promise<{ ok: boolean; status: number; body: string }>) | undefined
  const request = vi.fn(async (_path: string, _method?: string, body?: string) => {
    if (body) calls.push(JSON.parse(body))
    return response ? response() : { ok: true, status: 200, body: '{"ok":true}' }
  })
  const deps: LinkDependencies = { requireMembership: async () => {}, origin: 'https://relay.test', name: 'Host', platform: 'macos',
    account: { getState: async () => ({ status: 'authenticated', error: null,
      user: { id: 'owner', name: 'Owner', email: 'owner@test.invalid', avatarUrl: null } }),
    onState: () => () => {}, accessToken: async () => 'token', expire: async () => {} },
    identity: async () => ({ id: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) }),
    lease: async () => ({ runtimeToken: 'runtime', request }),
    fetch: async (input) => { const path = new URL(String(input)).pathname
      return Response.json(path.endsWith('/grants') ? { grants } : path.endsWith('/pairings') ?
        { pairings: [{ id: pairing, controllerId: phone, name: 'Phone' }] } : path.endsWith('/relay-tickets') ?
          { url: 'wss://relay.test/ws', ticket: 'ticket' } : { ok: true }) },
    socket: () => (socket = { onopen: null, onmessage: null, onerror: null, onclose: null,
      close: () => socket.onclose?.(), send: (raw) => frames.push(JSON.parse(raw)) }) }
  const service = new MobileLinkService(deps)
  const hello = () => socket.onmessage?.({ data: '{"v":1,"kind":"hello"}' })
  const invoke = (method: string, params: unknown, id = 'r', extra: Record<string, unknown> = {}) => socket.onmessage?.({ data: JSON.stringify({ v: 1,
    kind: 'invoke', src: phone, id, ...extra, scopes: ['groups.read'], payload: { method, params, requestId: id, expiresAt: Date.now() + 60000 } }) })
  return { service, calls, frames, request, hello, invoke, deps, grants: (value: typeof grants) => { grants = value },
    pause: (value: typeof response) => { response = value } }
}
describe('trusted desktop permission dispatch', () => {
  it('forwards only fixed history operations with the authenticated personal origin', async () => {
    const f = fixture()
    try {
      await f.service.enable(true); await tick(); f.hello()
      const fork = { threadId: 'task', turnId: 'turn', expectedRevision: 'thread-v1:1', historyVersion: 'version' }
      f.invoke('code.fork', fork, 'fork', { accountId: 'forged', deviceId: 'forged' })
      f.invoke('code.rewind.preview', fork, 'preview')
      f.invoke('code.rewind.commit', { threadId: 'task', token: 'a'.repeat(64) }, 'commit')
      await vi.waitFor(() => expect(f.calls).toHaveLength(3))
      expect(f.calls.map(call => call.call.method).sort()).toEqual(['code.fork', 'code.rewind.commit', 'code.rewind.preview'])
      for (const call of f.calls) expect(call).toMatchObject({ accountId: 'owner', deviceId: phone, scopes: ['personal'] })
      f.invoke('ipc.invoke', { channel: 'rewind' }, 'arbitrary'); await tick()
      expect(f.calls).toHaveLength(3)
      await f.service.revoke(grant)
      f.invoke('code.fork', fork, 'revoked'); await tick()
      expect(f.calls).toHaveLength(3)
    } finally { f.service.dispose(); await tick() }
  })
  it('ignores phone claimed scopes, assigns explicit pairing choices, and removes advanced rights on grant replacement', async () => {
    const f = fixture()
    try {
      await f.service.enable(true); await tick(); f.hello()
      f.invoke('group.list', {}); await tick()
      expect(f.calls).toEqual([])
      await vi.waitFor(() => expect(f.frames.find((v) => v.kind === 'result')?.payload.error).toMatchObject({ code: 'REMOTE_SCOPE_REQUIRED', uncertain: false }))
      await f.service.confirm(pairing, ['groups.read'])
      expect((await f.service.status()).grants[0].scopes).toEqual(['personal', 'groups.read'])
      f.invoke('group.list', {}, 'group'); await tick()
      expect(f.calls.at(-1)).toMatchObject({ scopes: ['personal', 'groups.read'], deviceId: phone })
      const priorAuthority = f.calls.at(-1).authorizationId
      await f.service.setScopes(grant, [])
      f.invoke('catalog.get', {}, 'catalog'); await tick()
      expect(f.calls.at(-1).scopes).toEqual(['personal'])
      expect(f.calls.at(-1).authorizationId).not.toBe(priorAuthority)
      // Control frames are paced 5 ms apart, so the notice may follow a batched acknowledgement.
      await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'resync_required' && frame.payload.reason === 'permissions_changed')).toBe(true))
      await f.service.setScopes(grant, ['groups.read'])
      f.grants([{ id: '55555555-5555-4555-8555-555555555555', controllerId: phone }])
      expect((await f.service.status()).grants[0].scopes).toEqual(['personal'])
    } finally { f.service.dispose(); await tick() }
  })
  it('fences a late reply on permission shrink without stopping the task and clears choices at next manual start', async () => {
    const f = fixture()
    try {
      await f.service.enable(true); await tick(); f.hello(); await f.service.setScopes(grant, ['groups.read'])
      let resolve!: (value: { ok: boolean; status: number; body: string }) => void
      f.pause(() => new Promise((done) => { resolve = done }))
      f.invoke('group.history', { roomId: 'room' }, 'old'); await tick()
      await f.service.setScopes(grant, [])
      resolve({ ok: true, status: 200, body: '{"private":"old group contents"}' }); await tick()
      expect(f.frames.filter((v) => v.kind === 'result' && v.id === 'old')).toEqual([])
      expect(f.calls.map((v) => v.call.method)).toEqual(['group.history'])
      await f.service.setScopes(grant, ['groups.read']); await f.service.enable(false); await f.service.enable(true)
      expect((await f.service.status()).grants[0].scopes).toEqual(['personal'])
    } finally { f.service.dispose(); await tick() }
  })
  it('advertises and dispatches native Desktop schedules only after trusted schedules.read consent', async () => {
    const f = fixture(), native = vi.fn(async (_method: string, _params: unknown, _scope: unknown, _lease: unknown) => ({ source: 'desktop_scheduler', schedules: [] }))
    f.deps.desktopSchedules = native
    f.pause(async () => ({ ok: true, status: 200, body: '{"capabilityDescriptors":[]}' }))
    try {
      await f.service.enable(true); await tick(); f.hello()
      f.invoke('desktop.schedule.list', {}, 'denied'); await tick()
      expect(native).not.toHaveBeenCalled()
      await f.service.confirm(pairing, ['schedules.read'])
      f.invoke('catalog.get', {}, 'native_catalog')
      await vi.waitFor(() => expect(f.frames.find((v) => v.id === 'native_catalog' && v.kind === 'result')?.payload.capabilityDescriptors)
        .toMatchObject([{ operation: 'desktop.schedule.list' }, { operation: 'desktop.schedule.runs.list' }]))
      f.invoke('desktop.schedule.list', {}, 'native_list')
      await vi.waitFor(() => expect(native).toHaveBeenCalledOnce())
      expect(native.mock.calls[0]![2]).toMatchObject({ accountId: 'owner', deviceId: phone, scopes: ['personal', 'schedules.read'] })
      await f.service.setScopes(grant, [])
      f.invoke('desktop.schedule.list', {}, 'revoked'); await tick()
      expect(native).toHaveBeenCalledOnce()
    } finally { f.service.dispose() }
  })

  it('never falls back a self-declared shared frame into personal task access', async () => {
    const f = fixture()
    try {
      await f.service.enable(true); await tick(); f.hello()
      f.invoke('code.history', { threadId: 'task' }, 'forged_shared', { shared: { shareId: 'share', role: 'guest' } })
      await tick()
      expect(f.calls).toEqual([])
      expect(f.frames.some((frame) => frame.kind === 'result' && frame.id === 'forged_shared')).toBe(false)
    } finally { f.service.dispose() }
  })

})
