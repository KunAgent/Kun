import { describe, expect, it } from 'vitest'
import { KUN_AVATAR_CATALOG, KUN_AVATAR_DEFAULT_PARTS, kunAvatarBodyClip, kunAvatarLayerKeys } from '@shared/rooms-api'

describe('wardrobe body coverage', () => {
  it('keeps resting wings for bare, scarf, vest, open apron and bag looks', () => {
    for (const outfit of [undefined, 'blue-scarf', 'red-scarf', 'cream-scarf', 'night-scarf', 'sports-vest', 'tool-apron', 'mailbag'] as const) {
      expect(kunAvatarBodyClip({ ...KUN_AVATAR_DEFAULT_PARTS, outfit })).toBeUndefined()
    }
  })
  it('uses one body registration for all feather colors and leaves the gripping wing above every garment', () => {
    const reference = kunAvatarBodyClip({ ...KUN_AVATAR_DEFAULT_PARTS, outfit: 'cream-shirt' })
    let covered = 0
    for (const outfit of KUN_AVATAR_CATALOG.outfit) {
      if (!kunAvatarBodyClip({ ...KUN_AVATAR_DEFAULT_PARTS, outfit: outfit.id })) continue
      covered++
      for (const color of KUN_AVATAR_CATALOG.color) {
        const parts = { ...KUN_AVATAR_DEFAULT_PARTS, outfit: outfit.id, color: color.id, prop: 'book' as const }
        expect(kunAvatarBodyClip(parts)).toEqual(reference)
        expect(kunAvatarLayerKeys(parts).slice(-2)).toEqual(['prop/book', `wing/${color.id}`])
      }
    }
    expect(covered).toBe(17)
    expect(kunAvatarBodyClip(KUN_AVATAR_DEFAULT_PARTS)).toBeUndefined()
  })
})
