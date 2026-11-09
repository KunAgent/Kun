import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteApi } from '@kun/remote-protocol'
import { ComputerHostAccess, COMPUTER_PAIRING_INTERVAL_MS } from './computer-host-access'

const owner = '11111111-1111-4111-8111-111111111111'
const pairing = { id: '22222222-2222-4222-8222-222222222222', controllerId: 'mac', name: 'Mac', purpose: 'desktop' as const }
const alive: ComputerHostAccess[] = []
afterEach(() => { for (const access of alive.splice(0)) access.reset(); vi.useRealTimers() })
function fixture() {
  const access = new ComputerHostAccess(); alive.push(access)
  let tier = 'max'
  const request = vi.fn(async (path: string, _method?: string) => path === '/capabilities'
    ? { desktop: { computerAccess: true } } : path === '/desktop/pairings' ? { pairings: [pairing] } : { ok: true })
  const api = { request, entitlements: async () => ({ version: 1, userId: owner, tier, effectiveTier: tier, status: 'active',
    expiresAt: null, checkedAt: new Date().toISOString(), revision: 1, features: { mobileRemote: true, personalAssistant: true } }) } as unknown as RemoteApi
  const changed = vi.fn(async () => {})
  const confirms = () => request.mock.calls.filter(([path]) => path.endsWith('/confirm'))
  return { access, api, request, changed, confirms, setTier: (value: string) => { tier = value } }
}
describe('unattended same-account desktop pairing', () => {
  it('does not approve anything until the local host is explicitly enabled', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.access.watch(f.api, () => true, f.changed)
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS * 2)
    expect(f.request).not.toHaveBeenCalled()
    await f.access.advertise(f.api, true, true, owner)
    f.access.watch(f.api, () => true, f.changed)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.confirms()).toEqual([['/desktop/pairings/' + pairing.id + '/confirm', 'POST']])
    expect(f.changed).toHaveBeenCalledOnce()
  })
  it('never automatically reauthorizes a locally revoked computer', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.access.advertise(f.api, true, true, owner)
    f.access.watch(f.api, () => false, f.changed)
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS * 2)
    expect(f.confirms()).toEqual([])
    expect(f.changed).not.toHaveBeenCalled()
  })
  it('does not approve phone pairings or pairings after a Max downgrade', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.access.advertise(f.api, true, true, owner)
    f.request.mockImplementation(async path => path === '/desktop/pairings' ? { pairings: [{ ...pairing, purpose: undefined }] } : { ok: true } as any)
    f.access.watch(f.api, () => true, f.changed)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.confirms()).toEqual([])
    f.request.mockImplementation(async () => ({ pairings: [pairing] }) as any)
    f.setTier('pro')
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS)
    expect(f.confirms()).toEqual([])
    expect(f.access.current()).toBe(false)
  })
  it('fences an in-flight directory read and clears its timer on disable/logout', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.access.advertise(f.api, true, true, owner)
    let resolve!: (value: any) => void
    f.request.mockImplementation(() => new Promise(done => { resolve = done }))
    f.access.watch(f.api, () => true, f.changed)
    f.access.reset()
    resolve({ pairings: [pairing] })
    await vi.advanceTimersByTimeAsync(COMPUTER_PAIRING_INTERVAL_MS * 3)
    expect(f.confirms()).toEqual([])
    expect(f.changed).not.toHaveBeenCalled()
    expect(f.request.mock.calls.filter(([path]) => path === '/desktop/pairings')).toHaveLength(1)
  })
  it('does not resurrect host consent after reset during advertisement', async () => {
    const f = fixture()
    let resolve!: (value: any) => void
    f.request.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = f.access.advertise(f.api, true, true, owner)
    const rejection = expect(pending).rejects.toThrow('ACCOUNT_CHANGED')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    f.access.reset(); resolve({ desktop: { computerAccess: true } })
    await rejection
    expect(f.access.current()).toBe(false)
    expect(f.request.mock.calls.some(([path]) => path === '/desktop/host')).toBe(false)
  })
})
