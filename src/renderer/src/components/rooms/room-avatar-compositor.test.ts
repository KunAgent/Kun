import { describe, expect, it } from 'vitest'
import { KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_SMALL_HEADWEAR } from '@shared/rooms-api'
import { avatarRenderRequest, composedAvatarLayers, composedAvatarSourceTier } from './room-avatar-compositor'

describe('layered avatar rendering plan', () => {
  it('uses canonical combinations, output pixels and crop mode as separate cache inputs', () => {
    const full = avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 96, 1)
    const retina = avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 48, 2)
    expect(full.pixels).toBe(retina.pixels)
    expect(full.key).not.toBe(retina.key)
    expect(full.compact).toBe(false)
    expect(retina.compact).toBe(true)
    expect(avatarRenderRequest({ ...KUN_AVATAR_DEFAULT_PARTS, bg: '#AABBCC' }, 96, 1).key)
      .toBe(avatarRenderRequest({ ...KUN_AVATAR_DEFAULT_PARTS, bg: '#aabbcc' }, 96, 1).key)
    expect(avatarRenderRequest({ ...KUN_AVATAR_DEFAULT_PARTS, face: 'happy' }, 96, 1).key).not.toBe(full.key)
  })

  it('separates compact variants and stage effects when CSS sizes share the same physical pixels', () => {
    const small = avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 24, 2)
    const compact = avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 48, 1)
    expect(small.pixels).toBe(compact.pixels)
    expect(small.key).not.toBe(compact.key)
    const stage = avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 96, 1, true)
    const gallery = avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 64, 1.5, true)
    expect(stage.pixels).toBe(gallery.pixels)
    expect(stage.key).not.toBe(gallery.key)
    expect(stage.effects).toBe(true)
    expect(gallery.effects).toBe(false)
    expect(stage.key).not.toBe(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 96, 1).key)
  })

  it('selects sufficiently dense source images for a retina face crop', () => {
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 96, 1))).toBe(128)
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 48, 2))).toBe(256)
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 48, 4))).toBe(512)
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 512, 2))).toBe(512)
  })

  it('places all preset layers in order and matches the gripping wing to the body', () => {
    for (const preset of KUN_AVATAR_PRESETS) {
      const { parts } = preset
      const layers = composedAvatarLayers(parts)
      const body = layers.indexOf(`base/${parts.color}`)
      const face = layers.indexOf(`face/${parts.face}`)
      expect(body).toBeGreaterThanOrEqual(0)
      expect(face).toBe(body + 1)
      if (parts.outfit) expect(layers.indexOf(`outfit/${parts.outfit}`)).toBeGreaterThan(face)
      if (parts.glasses) expect(layers.indexOf(`glasses/${parts.glasses}`)).toBeGreaterThan(face)
      if (parts.prop) expect(layers.slice(-2)).toEqual([`prop/${parts.prop}`, `wing/${parts.color}`])
    }
  })

  it('omits invisible props and gripping wings from compact render requests', () => {
    const parts = { ...KUN_AVATAR_DEFAULT_PARTS, prop: 'book' as const, outfit: 'cardigan' as const }
    for (const size of [24, 34, 48]) {
      const layers = composedAvatarLayers(parts, avatarRenderRequest(parts, size, 3))
      expect(layers.some((layer) => layer.startsWith('prop/') || layer.startsWith('wing/'))).toBe(false)
      expect(layers).toContain('outfit/cardigan')
    }
    expect(composedAvatarLayers(parts, { size: 49 })).toContain('prop/book')
  })

  it('uses small glasses through 34px and small hats throughout the 48px compact crop', () => {
    for (const glasses of KUN_AVATAR_CATALOG.glasses) {
      const parts = { ...KUN_AVATAR_DEFAULT_PARTS, glasses: glasses.id }
      expect(composedAvatarLayers(parts, { size: 34 })).toContain(`glasses/${glasses.id}.small`)
      expect(composedAvatarLayers(parts, { size: 35 })).toContain(`glasses/${glasses.id}`)
    }
    for (const headwear of KUN_AVATAR_CATALOG.headwear) {
      for (const size of [24, 34, 48]) {
        const layers = composedAvatarLayers({ ...KUN_AVATAR_DEFAULT_PARTS, headwear: headwear.id }, { size })
        expect(layers).toContain(`headwear/${headwear.id}${KUN_AVATAR_SMALL_HEADWEAR.includes(headwear.id) ? '.small' : ''}`)
      }
      expect(composedAvatarLayers({ ...KUN_AVATAR_DEFAULT_PARTS, headwear: headwear.id }, { size: 49 }))
        .toContain(`headwear/${headwear.id}`)
    }
  })

  it('places simplified scenes below the bird and shows only the highest rarity effect on stages', () => {
    const parts = { ...KUN_AVATAR_DEFAULT_PARTS, bg: 'scene:star-deck',
      headwear: 'hood' as const, outfit: 'wizard-cape' as const }
    expect(composedAvatarLayers(parts, { size: 48 })[0]).toBe('scene/star-deck.small')
    expect(composedAvatarLayers(parts, { size: 96 })[0]).toBe('scene/star-deck')
    expect(composedAvatarLayers(parts, { size: 96 }).some((key) => key.startsWith('fx/'))).toBe(false)
    expect(composedAvatarLayers(parts, { size: 95, effects: true }).some((key) => key.startsWith('fx/'))).toBe(false)
    const effects = composedAvatarLayers(parts, { size: 96, effects: true })
    expect(effects.slice(0, 4)).toEqual(['scene/star-deck', 'fx/legendary.back', 'outfit/wizard-cape.back', 'headwear/hood.back'])
    expect(effects.at(-1)).toBe('fx/legendary')
    expect(composedAvatarLayers({ ...parts, outfit: undefined }, { size: 96, effects: true }).at(-1)).toBe('fx/epic')
    expect(composedAvatarLayers(KUN_AVATAR_DEFAULT_PARTS, { size: 96, effects: true }).some((key) => key.startsWith('fx/'))).toBe(false)
  })

  it('splits rear layers and respects hidden or tucked crests', () => {
    for (const headwear of KUN_AVATAR_CATALOG.headwear) {
      const layers = composedAvatarLayers({ ...KUN_AVATAR_DEFAULT_PARTS, headwear: headwear.id })
      const crest = layers.find((layer) => layer.startsWith('crest/'))
      if (headwear.crest === 'hidden') expect(crest).toBeUndefined()
      else expect(crest).toBe(`crest/${headwear.crest === 'tucked' ? 'tucked-' : ''}${KUN_AVATAR_DEFAULT_PARTS.color}`)
      if (headwear.hasBack) expect(layers[0]).toBe(`headwear/${headwear.id}.back`)
    }
    for (const outfit of KUN_AVATAR_CATALOG.outfit.filter((item) => item.hasBack)) {
      expect(composedAvatarLayers({ ...KUN_AVATAR_DEFAULT_PARTS, outfit: outfit.id })[0]).toBe(`outfit/${outfit.id}.back`)
    }
  })
})
