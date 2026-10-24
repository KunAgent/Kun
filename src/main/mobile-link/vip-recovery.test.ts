import { expect, it } from 'vitest'
import { MobileLinkService, type LinkDependencies } from './service'
it('a known membership denial during startup or explicit retry never disables the host or revokes its grants', async () => {
  const enables: boolean[] = []
  const deps: LinkDependencies = {
    account: {
      getState: async () => ({ status: 'authenticated', error: null, user: { id: 'owner', name: 'Owner', email: 'owner@test', avatarUrl: null } }),
      accessToken: async () => 'token', expire: async () => {}, onState: () => () => {}
    },
    identity: async () => ({ id: '11111111-1111-1111-1111-111111111111', credential: 'a'.repeat(64) }),
    origin: 'https://vip.test', name: 'Desktop', platform: 'macos',
    socket: () => { throw new Error('socket must not start') }, lease: async () => { throw new Error('runtime must not run') },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/devices/enabled')) {
        const enabled = JSON.parse(String(init?.body)).enabled
        enables.push(enabled)
        return Response.json(enabled ? { error: 'vip_mobile_remote_required' } : { ok: true }, { status: enabled ? 403 : 200 })
      }
      return Response.json({ deviceId: '11111111-1111-1111-1111-111111111111', enabled: true })
    }
  }
  const service = new MobileLinkService(deps)
  try {
    await expect(service.enable(true, true)).rejects.toMatchObject({ code: 'vip_mobile_remote_required' })
    expect((await service.status()).error).toBe('VIP_REQUIRED')
    await expect(service.retryMembership()).rejects.toMatchObject({ code: 'vip_mobile_remote_required' })
    expect(enables).toEqual([true, true])
  } finally { service.dispose(true) }
})

it('metadata outages preserve the terminal VIP state and its explicit recovery action', async () => {
  let metadataOffline = false, tickets = 0
  const service = new MobileLinkService({
    account: {
      getState: async () => ({ status: 'authenticated', error: null, user: { id: 'owner', name: 'Owner', email: 'owner@test', avatarUrl: null } }),
      accessToken: async () => 'token', expire: async () => {}, onState: () => () => {}
    },
    identity: async () => ({ id: '11111111-1111-1111-1111-111111111111', credential: 'a'.repeat(64) }),
    origin: 'https://vip.test', name: 'Desktop', platform: 'macos',
    socket: () => { throw new Error('socket must not start') }, lease: async () => { throw new Error('runtime must not run') },
    fetch: async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/relay-tickets')) {
        tickets++
        return Response.json({ error: 'vip_mobile_remote_required' }, { status: 403 })
      }
      if (path.endsWith('/pairings') || path.endsWith('/grants')) {
        return metadataOffline ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ pairings: [], grants: [] })
      }
      return Response.json({ ok: true, owned: [], joined: [] })
    }
  })
  try {
    await service.enable(true, true)
    await new Promise(resolve => setImmediate(resolve))
    expect((await service.status()).error).toBe('VIP_REQUIRED')
    metadataOffline = true
    expect((await service.status()).error).toBe('VIP_REQUIRED')
    metadataOffline = false
    expect((await service.status()).error).toBe('VIP_REQUIRED')
    expect(tickets).toBe(1)
  } finally { service.dispose(true) }
})
