import { describe, expect, it } from 'vitest'
import { MobileLinkAuthorities } from './authorities'
import { mobileLinkScopes } from '../../shared/mobile-link-scopes'
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
  it('rejects unknown/duplicate and inconsistent trusted UI choices without modifying authority', () => {
    for (const value of [['unknown'], ['groups.read', 'groups.read'], ['groups.write'], ['collaboration.read'],
      ['groups.read', 'collaboration.control'], 'groups.read']) expect(() => mobileLinkScopes(value)).toThrow('INVALID_SCOPES')
    expect(mobileLinkScopes([])).toEqual(['personal'])
  })
})
