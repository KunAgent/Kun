import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileLinkService, type LinkDependencies } from './service'
import { COMPUTER_PAIRING_INTERVAL_MS } from './computer-host-access'

const owner = '11111111-1111-4111-8111-111111111111'
const peer = '22222222-2222-4222-8222-222222222222'
const pairingId = '33333333-3333-4333-8333-333333333333'
const grantId = '44444444-4444-4444-8444-444444444444'
const services: MobileLinkService[] = []
afterEach(() => { for (const service of services.splice(0)) service.dispose(); vi.useRealTimers() })
function fixture() {
  let pending = false, paired = false
  let entitlementWait: Promise<void> | undefined
  const phoneGrant = { id: '55555555-5555-4555-8555-555555555555', controllerId: 'phone' }
  const calls: Array<{ path: string; method?: string; body: any }> = []
  const configureRemoteAccess = vi.fn(async (_enabled: boolean, _current?: () => boolean) => {})
  const deps: LinkDependencies = {
    computerAccess: true, requireMembership: async () => {}, origin: 'https://relay.test', name: 'Host', platform: 'macos',
    account: { getState: async () => ({ status: 'authenticated', user: { id: owner } }), accessToken: async () => 'token', onState: () => () => {} } as any,
    identity: async () => ({ id: owner, credential: 'a'.repeat(64) }),
    lease: async () => { throw Error('Desktop grants must not reach Kun') },
    desktop: { configureRemoteAccess, stopAll: async () => {}, authorityChanged() {} } as any,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname.replace('/api/remote/v1', '')
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ path, method: init?.method, body })
      if (path.endsWith('/entitlements')) await entitlementWait
      if (path.endsWith('/confirm')) { pending = false; paired = true }
      if (path === '/grants/' + grantId && init?.method === 'DELETE') paired = false
      const value = path.endsWith('/entitlements') ? { version: 1, userId: owner, tier: 'max', effectiveTier: 'max', status: 'active',
        expiresAt: null, checkedAt: new Date().toISOString(), revision: 1, features: { mobileRemote: true, personalAssistant: true } }
        : path === '/capabilities' ? { desktop: { computerAccess: true } }
        : path === '/desktop/pairings' ? { pairings: pending ? [{ id: pairingId, controllerId: peer, name: 'Other Mac', purpose: 'desktop' }] : [] }
        : path === '/pairings' ? { pairings: [] }
        : path === '/desktop/grants' ? { grants: paired ? [{ id: grantId, controllerId: peer, purpose: 'desktop' }] : [] }
        : path === '/grants' ? { grants: [phoneGrant] } : { ok: true }
      return Response.json(value)
    },
    socket: () => { throw Error('unexpected socket') },
    createClient: () => ({ online: true, start() {}, stop() {}, reconnect() {}, resume() {}, send() {} })
  }
  const service = new MobileLinkService(deps); services.push(service)
  return { service, deps, calls, configureRemoteAccess, phoneGrant, request: () => { pending = true },
    pauseEntitlements: (wait: Promise<void>) => { entitlementWait = wait },
    confirms: () => calls.filter(call => call.path.endsWith('/confirm')) }
}
describe('computer host consent lifecycle', () => {
  it('requires the computer host switch even when phone desktop access is on', async () => {
    const f = fixture()
    const status = await f.service.enable(true, true, true)
    expect(status.desktopAccess).toBe(true)
    expect(status.computerAccess).toBe(false)
    expect(f.calls.some(call => call.path === '/desktop/host' && call.body?.enabled === true)).toBe(false)
  })
  it('automatically pairs in the background and preserves restricted and revoked grants', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enableComputerAccess(true)
    f.request()
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS)
    expect(f.confirms()).toHaveLength(1)
    expect((await f.service.status()).grants[0].scopes).toEqual(['desktop.view', 'desktop.control'])
    await f.service.setScopes(grantId, ['desktop.view'])
    expect((await f.service.status()).grants[0].scopes).toEqual(['desktop.view'])
    await f.service.revoke(grantId)
    f.request()
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS * 2)
    expect(f.confirms()).toHaveLength(1)
    await f.service.enableComputerAccess(false)
    expect((await f.service.status()).computerAccess).toBe(false)
    expect(f.configureRemoteAccess).toHaveBeenLastCalledWith(false)
    const before = f.calls.length
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS * 2)
    expect(f.calls).toHaveLength(before)
  })
  it('does not reactivate retained phone grants from the computer-only switch', async () => {
    const f = fixture()
    const status = await f.service.enableComputerAccess(true)
    expect(status.computerAccess).toBe(true)
    expect(status.enabled).toBe(false)
    expect(status.grants).toEqual([])
    await expect(f.service.setScopes(f.phoneGrant.id, [])).rejects.toThrow('INVALID_GRANT')
    const stopped = await f.service.enableComputerAccess(false)
    expect(stopped.enabled).toBe(false)
    expect(stopped.computerAccess).toBe(false)
    expect(stopped.grants).toEqual([])
  })
  it('cannot restore desktop scopes after a denial during Max verification', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.enableComputerAccess(true); f.request()
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS)
    await f.service.setScopes(grantId, ['desktop.view'])
    let release!: () => void
    f.pauseEntitlements(new Promise<void>(done => { release = done }))
    const expansion = f.service.setScopes(grantId, ['desktop.view', 'desktop.control'])
    const rejection = expect(expansion).rejects.toThrow('INVALID_GRANT')
    await f.service.setScopes(grantId, [])
    release(); await rejection
    expect((await f.service.status()).grants[0].scopes).toEqual([])
  })
  it('never advertises direct access if local desktop configuration fails', async () => {
    const f = fixture()
    f.configureRemoteAccess.mockImplementation(async enabled => { if (enabled) throw Error('SCREEN_PERMISSION_REQUIRED') })
    await expect(f.service.enableComputerAccess(true)).rejects.toThrow('SCREEN_PERMISSION_REQUIRED')
    expect((await f.service.status()).computerAccess).toBe(false)
    expect(f.calls.some(call => call.path === '/desktop/host' && call.body?.enabled === true)).toBe(false)
  })
  it('does not let a pending enable overwrite a later local disable', async () => {
    const f = fixture()
    await f.service.enable(true, true)
    let resolve!: () => void
    f.configureRemoteAccess.mockImplementation(async enabled => { if (enabled) await new Promise<void>(done => { resolve = done }) })
    const enabling = f.service.enableComputerAccess(true)
    const rejection = expect(enabling).rejects.toThrow('ACCOUNT_CHANGED')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await f.service.enableComputerAccess(false)
    resolve(); await rejection
    expect((await f.service.status()).computerAccess).toBe(false)
    expect(f.calls.some(call => call.path === '/desktop/host' && call.body?.enabled === true)).toBe(false)
  })
})
