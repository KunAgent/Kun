import { expect, it } from 'vitest'
import { MobileLinkService, type LinkDependencies } from './service'
import { requireAccountFeature } from '../account-entitlements'
it('a known membership denial during startup or explicit retry never disables the host or revokes its grants', async () => {
  const enables: boolean[] = []
  const deps: LinkDependencies = { requireMembership: async () => {},
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

for (const scenario of ['missing endpoint', 'free account'] as const) it(`never opens remote access against a permissive legacy server: ${scenario}`, async () => {
  const owner = '11111111-1111-1111-1111-111111111111', requests: string[] = []
  const deps: LinkDependencies = {
    account: {
      getState: async () => ({ status: 'authenticated', error: null, user: { id: owner, name: 'Owner', email: 'owner@test', avatarUrl: null } }),
      accessToken: async () => 'token', expire: async () => {}, onState: () => () => {}
    },
    requireMembership: owner => requireAccountFeature(deps.account, deps.fetch, 'mobileRemote', owner, deps.origin),
    identity: async () => { throw new Error('identity must not be created') },
    origin: 'https://vip.test', name: 'Desktop', platform: 'macos',
    socket: () => { throw new Error('socket must not start') }, lease: async () => { throw new Error('runtime must not run') },
    fetch: async input => {
      const path = new URL(String(input)).pathname; requests.push(path)
      if (path.endsWith('/entitlements')) return scenario === 'missing endpoint'
        ? Response.json({ error: 'not_found' }, { status: 404 })
        : Response.json({ version: 1, userId: owner, tier: 'free', effectiveTier: 'free', status: 'free', expiresAt: null, revision: 0, checkedAt: new Date().toISOString(), features: { mobileRemote: false, personalAssistant: false } })
      return Response.json({ ok: true })
    }
  }
  const service = new MobileLinkService(deps)
  try {
    await expect(service.enable(true)).rejects.toMatchObject({ code: scenario === 'missing endpoint' ? 'ENTITLEMENTS_UNAVAILABLE' : 'vip_mobile_remote_required' })
    expect(requests).toEqual(['/api/account/v1/entitlements'])
    expect((await service.status()).enabled).toBe(false)
  } finally { service.dispose(true) }
})

it('metadata outages preserve the terminal VIP state and its explicit recovery action', async () => {
  let metadataOffline = false, tickets = 0
  const service = new MobileLinkService({ requireMembership: async () => {},
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
