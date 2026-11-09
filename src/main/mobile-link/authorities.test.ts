import { describe, expect, it } from 'vitest'
import { MobileLinkAuthorities } from './authorities'
import { mobileLinkScopes, MOBILE_REMOTE_SCOPES } from '../../shared/mobile-link-scopes'
describe('advanced mobile permissions are tied to one enable session and exact cloud grant', () => {
  it('defaults to personal, survives transport reconnect, and fences grant replacement or scope changes', () => {
    const store = new MobileLinkAuthorities(), grants = [{ id: 'grant', controllerId: 'phone' }]
    expect(store.scopes('phone', 'grant')).toEqual(['personal'])
    const original = store.identity('transport', 'phone', 'grant')
    store.set('phone', 'grant', ['groups.read', 'groups.write'])
    const upgraded = store.identity('transport', 'phone', 'grant')
    expect(upgraded).not.toBe(original)
    expect(store.sync(grants)).toEqual([])
    expect(store.scopes('phone', 'grant')).toEqual(['personal', 'groups.read', 'groups.write'])
    expect(store.identity('next-transport', 'phone', 'grant')).not.toBe(upgraded)
    store.set('phone', 'grant', ['personal'])
    expect(store.identity('transport', 'phone', 'grant')).not.toBe(upgraded)
    store.set('phone', 'grant', ['groups.read'])
    expect(store.sync([{ id: 'new-grant', controllerId: 'phone' }])).toEqual(['phone'])
    expect(store.scopes('phone', 'new-grant')).toEqual(['personal'])
    expect(store.identity('transport', 'phone', 'new-grant')).not.toBe(original)
    store.set('phone', 'new-grant', ['groups.read']); store.clear()
    expect(store.scopes('phone', 'new-grant')).toEqual(['personal'])
  })
  it('defaults paired grants to desktop access only after unified consent and preserves explicit overrides', () => {
    const store = new MobileLinkAuthorities(), grants = [{ id: 'grant', controllerId: 'phone' }]
    expect(store.scopes('phone', undefined)).toEqual(['personal'])
    store.sync(grants, MOBILE_REMOTE_SCOPES)
    expect(store.scopes('phone', 'grant')).toEqual(MOBILE_REMOTE_SCOPES)
    const identity = store.identity('transport', 'phone', 'grant')
    store.set('phone', 'grant', [])
    store.sync(grants, MOBILE_REMOTE_SCOPES)
    expect(store.scopes('phone', 'grant')).toEqual(['personal'])
    expect(store.identity('transport', 'phone', 'grant')).not.toBe(identity)
    store.sync([{ id: 'new', controllerId: 'phone' }], MOBILE_REMOTE_SCOPES)
    expect(store.scopes('phone', 'grant')).toEqual(['personal'])
    expect(store.scopes('phone', 'new')).toEqual(MOBILE_REMOTE_SCOPES)
    store.clear(); expect(store.scopes('phone', 'new')).toEqual(['personal'])
  })
  it('rejects unknown/duplicate and inconsistent trusted UI choices without modifying authority', () => {
    for (const value of [['unknown'], ['groups.read', 'groups.read'], ['groups.write'], ['collaboration.read'],
      ['groups.read', 'collaboration.control'], 'groups.read']) expect(() => mobileLinkScopes(value)).toThrow('INVALID_SCOPES')
    expect(mobileLinkScopes([])).toEqual(['personal'])
  })
})
