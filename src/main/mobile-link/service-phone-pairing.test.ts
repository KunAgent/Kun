import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_DEFAULT_SCOPES, MOBILE_REMOTE_SCOPES } from '../../shared/mobile-link-scopes'
import { MobileLinkService, type LinkDependencies } from './service'
import { PHONE_PAIRING_INTERVAL_MS } from './phone-pairing-approval'

const owner = '11111111-1111-4111-8111-111111111111'
const phone = '22222222-2222-4222-8222-222222222222'
const pairingId = '33333333-3333-4333-8333-333333333333'
const grantId = '44444444-4444-4444-8444-444444444444'
type Pairing = { id: string; controllerId: string; name: string; purpose?: 'desktop' }
const services: MobileLinkService[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
})
function fixture() {
  let pending: Pairing[] = [], paired = false
  const calls: Array<{ path: string; method?: string }> = []
  const deps: LinkDependencies = {
    origin: 'https://relay.test', name: 'Host', platform: 'macos',
    requireMembership: async () => {},
    account: {
      getState: async () => ({ status: 'authenticated', error: null,
        user: { id: owner, name: 'Owner', email: 'owner@test.invalid', avatarUrl: null } }),
      onState: () => () => {}, accessToken: async () => 'token', expire: async () => {}
    },
    identity: async () => ({ id: owner, credential: 'a'.repeat(64) }),
    lease: async () => { throw Error('phone grants must not reach Kun') },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname.replace('/api/remote/v1', '')
      calls.push({ path, method: init?.method })
      if (path.endsWith('/confirm')) {
        paired = true
        pending = pending.filter((item) => !path.includes(item.id))
      }
      return Response.json(
        path === '/pairings' ? { pairings: pending }
          : path === '/grants' ? { grants: paired ? [{ id: grantId, controllerId: phone }] : [] }
            : { ok: true }
      )
    },
    socket: () => { throw Error('unexpected socket') },
    createClient: (transport) => ({
      online: true,
      start() { transport.state?.(true); transport.leaseChanged?.(Date.now() + 300000) },
      stop() {}, reconnect() {}, resume() {}, send() {}
    })
  }
  const service = new MobileLinkService(deps)
  services.push(service)
  return {
    service, calls,
    request: (next: Pairing[]) => { pending = next },
    confirms: () => calls.filter((call) => call.path.endsWith('/confirm'))
  }
}
describe('phone pairing approval', () => {
  it('approves a phone pairing in the background and keeps the request out of the host UI', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enable(true)
    f.request([{ id: pairingId, controllerId: phone, name: 'iPhone' }])
    expect((await f.service.status()).pairings).toEqual([])
    await vi.advanceTimersByTimeAsync(PHONE_PAIRING_INTERVAL_MS)
    expect(f.confirms()).toEqual([{ path: '/pairings/' + pairingId + '/confirm', method: 'POST' }])
    expect((await f.service.status()).grants).toMatchObject([{ id: grantId, scopes: MOBILE_DEFAULT_SCOPES }])
  })
  it('keeps a locally revoked phone manual instead of re-approving its next request', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enable(true)
    f.request([{ id: pairingId, controllerId: phone, name: 'iPhone' }])
    await vi.advanceTimersByTimeAsync(PHONE_PAIRING_INTERVAL_MS)
    expect(f.confirms()).toHaveLength(1)
    await f.service.revoke(grantId)
    f.request([{ id: '55555555-5555-4555-8555-555555555555', controllerId: phone, name: 'iPhone' }])
    expect((await f.service.status()).pairings).toMatchObject([{ controllerId: phone }])
    await vi.advanceTimersByTimeAsync(PHONE_PAIRING_INTERVAL_MS * 2)
    expect(f.confirms()).toHaveLength(1)
  })
  it('grants the same machine-wide scopes the unified desktop switch promises', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enable(true, true, true)
    f.request([{ id: pairingId, controllerId: phone, name: 'iPhone' }])
    await vi.advanceTimersByTimeAsync(PHONE_PAIRING_INTERVAL_MS)
    expect((await f.service.status()).grants[0].scopes)
      .toEqual(MOBILE_REMOTE_SCOPES)
  })
  it('leaves computer pairings to the computer host switch', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enable(true)
    f.request([{ id: pairingId, controllerId: phone, name: 'Other Mac', purpose: 'desktop' }])
    await vi.advanceTimersByTimeAsync(PHONE_PAIRING_INTERVAL_MS * 2)
    expect(f.confirms()).toEqual([])
    expect((await f.service.status()).pairings).toMatchObject([{ id: pairingId, purpose: 'desktop' }])
  })
  it('does not approve phone pairings when the local phone switch is off', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enable(true, true, false, false)
    f.request([{ id: pairingId, controllerId: phone, name: 'iPhone' }])
    await vi.advanceTimersByTimeAsync(PHONE_PAIRING_INTERVAL_MS * 2)
    expect(f.confirms()).toEqual([])
  })
})
