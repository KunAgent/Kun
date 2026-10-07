import { describe, expect, it } from 'vitest'
import { KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS } from '@shared/rooms-api'
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

  it('selects sufficiently dense source images for a retina face crop', () => {
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 96, 1))).toBe(128)
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 48, 2))).toBe(256)
    expect(composedAvatarSourceTier(avatarRenderRequest(KUN_AVATAR_DEFAULT_PARTS, 48, 3))).toBe(512)
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
