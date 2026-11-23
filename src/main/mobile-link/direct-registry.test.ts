import { expect, it, vi } from 'vitest'
import { parseDirectPairing } from '@kun/remote-protocol'
import { DIRECT_MOBILE_DEFAULT_SCOPES } from '../../shared/mobile-link-scopes'
import { DirectRegistry, emptyDirectSettings } from './direct-registry'
it('grants full direct-compatible scopes by default, consumes a pairing once and enforces explicit narrowing', async () => {
  const persist = vi.fn(async () => {}), registry = new DirectRegistry('host', 'Mac', emptyDirectSettings(), persist)
  const defaultPairing = parseDirectPairing(registry.pair(['http://10.0.0.1']))
  const defaultGrant = await registry.accept(defaultPairing.id, true, 'default-phone', 'Default Phone')
  expect(defaultGrant.scopes).toEqual(DIRECT_MOBILE_DEFAULT_SCOPES)
  await registry.revoke(defaultGrant.id)
  const pairing = parseDirectPairing(registry.pair(['http://10.0.0.1'], ['personal']))
  const result = await Promise.allSettled([registry.accept(pairing.id, true, 'phone', 'Phone'), registry.accept(pairing.id, true, 'other', 'Other')])
  expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  const grant = registry.settings.grants[0]
  expect(grant.scopes).toEqual(['personal'])
  await expect(registry.accept(grant.id, false, 'other', 'Other')).rejects.toThrow('DIRECT_AUTH_FAILED')
  await registry.revoke(grant.id)
  expect(registry.valid(grant)).toBe(false)
  expect(registry.credential(grant.id, false)).toBeUndefined()
})
it('expired and invalid pairing grants never create persistent access', async () => {
  let now = Date.now()
  const persist = vi.fn(async () => {}), registry = new DirectRegistry('host', 'Mac', emptyDirectSettings(), persist, () => now)
  const pairing = parseDirectPairing(registry.pair(['http://10.0.0.1'], ['personal']))
  now += 300001
  await expect(registry.accept(pairing.id, true, 'phone', 'Phone')).rejects.toThrow('DIRECT_AUTH_FAILED')
  expect(persist).not.toHaveBeenCalled()
  expect(() => registry.pair(['http://10.0.0.1'], ['desktop.control'])).toThrow('INVALID_SCOPES')
})
it('durable revocation does not need to rewrite a locked encrypted credential store', async () => {
  let locked = false
  const tombstones = new Set<string>()
  const registry = new DirectRegistry('host', 'Mac', emptyDirectSettings(), async () => {
    if (locked) throw Error('KEYCHAIN_LOCKED')
  }, Date.now, async id => { tombstones.add(id) })
  const pairing = parseDirectPairing(registry.pair(['http://10.0.0.1'], ['personal']))
  const grant = await registry.accept(pairing.id, true, 'phone', 'Phone')
  locked = true
  await registry.revoke(grant.id)
  expect(tombstones.has(grant.id)).toBe(true)
  expect(registry.valid(grant)).toBe(false)
  expect(registry.settings.grants).toEqual([])
})
