import { describe, expect, it } from 'vitest'
import { CreateAgentRequest, UpdateAgentRequest } from './agent-identities.js'
import { RoomAvatarReferenceSchema } from './room-content.js'
import { RoomMemberSchema } from './rooms.js'
import { RoomUserProfileSchema } from './room-onboarding.js'
import { KunAvatarPartsSchema } from './kun-avatar-schema.js'
import { KUN_AVATAR_PRESETS, ROOM_BUILTIN_AVATAR_IDS } from './kun-avatar-presets.js'
import { KUN_AVATAR_CATALOG, KUN_AVATAR_ACCESSORY_CATEGORIES, KUN_AVATAR_DEFAULT_PARTS,
  normalizeKunAvatarParts, getKunAvatarConflicts, updateKunAvatarPart, randomKunAvatarParts,
  canonicalKunAvatarKey, type KunAvatarParts } from './kun-avatar-catalog.js'

const composed = (parts: Partial<KunAvatarParts> = {}) => ({
  kind: 'composed', version: 1, parts: normalizeKunAvatarParts(parts)
})

describe('composed avatar contracts', () => {
  it('preserves every legacy avatar and default profile', () => {
    for (const id of ROOM_BUILTIN_AVATAR_IDS) {
      const avatar = { kind: 'builtin', id }
      expect(RoomAvatarReferenceSchema.parse(avatar)).toEqual(avatar)
    }
    const avatar = { kind: 'uploaded', attachmentId: `att_${'a'.repeat(24)}` }
    expect(RoomAvatarReferenceSchema.parse(avatar)).toEqual(avatar)
    expect(RoomUserProfileSchema.parse({})).toEqual({ avatar: null })
  })

  it('supports the new reference through existing profile, Agent and member contracts', () => {
    const avatar = composed({ color: 'mint', face: 'happy', outfit: 'red-scarf', prop: 'book' })
    expect(RoomAvatarReferenceSchema.parse(avatar)).toEqual(avatar)
    expect(RoomUserProfileSchema.parse({ avatar }).avatar).toEqual(avatar)
    expect(CreateAgentRequest.parse({ clientRequestId: 'create', name: 'Agent', avatar }).avatar).toEqual(avatar)
    expect(UpdateAgentRequest.parse({ clientRequestId: 'update', expectedRevision: 0, avatar }).avatar).toEqual(avatar)
    expect(RoomMemberSchema.parse({ id: 'member', revision: 0, displayName: 'Member',
      presetId: 'general', role: 'developer', avatar }).avatar).toEqual(avatar)
  })

  it('defaults and canonicalizes background while requiring body color and face', () => {
    expect(KunAvatarPartsSchema.parse({ color: 'sky', face: 'normal' })).toEqual(KUN_AVATAR_DEFAULT_PARTS)
    expect(KunAvatarPartsSchema.parse({ ...KUN_AVATAR_DEFAULT_PARTS, bg: '#AABBCC' }).bg).toBe('#aabbcc')
    expect(KunAvatarPartsSchema.parse({ ...KUN_AVATAR_DEFAULT_PARTS, bg: 'transparent' }).bg).toBe('transparent')
    expect(KunAvatarPartsSchema.safeParse({ face: 'normal' }).success).toBe(false)
    expect(KunAvatarPartsSchema.safeParse({ color: 'sky' }).success).toBe(false)
  })

  it('rejects unsupported versions, unknown fields, IDs in the wrong slot and non-hex backgrounds', () => {
    const invalid = [
      { ...composed(), version: 2 }, { ...composed(), extra: true },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, unknown: true } },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, color: 'red' } },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, face: 'wink' } },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, headwear: 'square' } },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, glasses: 'headset' } },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, outfit: 'book' } },
      { ...composed(), parts: { ...KUN_AVATAR_DEFAULT_PARTS, prop: 'red-scarf' } },
      ...['red', '#fff', '#aabbccdd', 'url(file:///tmp/avatar.png)', ''].map((bg) => composed({ bg }))
    ]
    for (const avatar of invalid) expect(RoomAvatarReferenceSchema.safeParse(avatar).success).toBe(false)
  })

  it('rejects helmet/glasses conflicts, including every preset eye accessory', () => {
    for (const { id } of KUN_AVATAR_CATALOG.glasses) {
      const avatar = composed({ headwear: 'astronaut-helmet', glasses: id })
      expect(RoomAvatarReferenceSchema.safeParse(avatar).success).toBe(false)
    }
    expect(RoomAvatarReferenceSchema.safeParse(composed({ headwear: 'astronaut-helmet' })).success).toBe(true)
    expect(RoomAvatarReferenceSchema.safeParse(composed({ headwear: 'hood', glasses: 'square' })).success).toBe(true)
  })
})

describe('shared avatar catalog', () => {
  it('covers all required parts and the 30 stable role IDs with valid complete presets', () => {
    expect(Object.fromEntries(Object.entries(KUN_AVATAR_CATALOG).map(([category, parts]) =>
      [category, parts.length]))).toEqual({ color: 4, face: 2, headwear: 19, glasses: 5, outfit: 24, prop: 9 })
    for (const entries of Object.values(KUN_AVATAR_CATALOG)) {
      expect(new Set(entries.map((part) => part.id)).size).toBe(entries.length)
      for (const entry of entries) {
        expect(entry.label.zh.length).toBeGreaterThan(0)
        expect(entry.label.en.length).toBeGreaterThan(0)
      }
    }
    expect(KUN_AVATAR_PRESETS.map((preset) => preset.id)).toEqual(ROOM_BUILTIN_AVATAR_IDS)
    for (const preset of KUN_AVATAR_PRESETS) expect(RoomAvatarReferenceSchema.safeParse(composed(preset.parts)).success).toBe(true)
    for (const category of KUN_AVATAR_ACCESSORY_CATEGORIES) {
      const represented = new Set(KUN_AVATAR_PRESETS.map((preset) => preset.parts[category]))
      for (const part of KUN_AVATAR_CATALOG[category]) expect(represented.has(part.id)).toBe(true)
    }
  })

  it('has explicit rear layers and crest states for occlusion', () => {
    expect(KUN_AVATAR_CATALOG.headwear.filter((part) => part.hasBack).map((part) => part.id))
      .toEqual(['astronaut-helmet', 'hood'])
    expect(KUN_AVATAR_CATALOG.outfit.filter((part) => part.hasBack).map((part) => part.id))
      .toEqual(['storyteller-cape', 'wizard-cape'])
    expect(KUN_AVATAR_CATALOG.headwear.find((part) => part.id === 'detective-hat')?.crest).toBe('tucked')
    expect(KUN_AVATAR_CATALOG.headwear.find((part) => part.id === 'headset')?.hidesCrest).toBe(false)
    expect(KUN_AVATAR_CATALOG.headwear.find((part) => part.id === 'beanie')?.hidesCrest).toBe(true)
  })

  it('replaces conflicts in both directions without modifying the draft input', () => {
    const original = normalizeKunAvatarParts({ glasses: 'square', prop: 'book' })
    const helmet = updateKunAvatarPart(original, 'headwear', 'astronaut-helmet')
    expect(helmet.removed).toEqual(['glasses'])
    expect(helmet.parts).toEqual(normalizeKunAvatarParts({ headwear: 'astronaut-helmet', prop: 'book' }))
    expect(original.glasses).toBe('square')
    const glasses = updateKunAvatarPart(helmet.parts, 'glasses', 'round')
    expect(glasses.removed).toEqual(['headwear'])
    expect(glasses.parts.headwear).toBeUndefined()
    expect(glasses.parts.glasses).toBe('round')
    expect(updateKunAvatarPart(glasses.parts, 'glasses', undefined).parts).not.toHaveProperty('glasses')
  })

  it('canonicalizes cache keys across object ordering, absent slots and hex case', () => {
    expect(canonicalKunAvatarKey({ face: 'normal', bg: '#F7F5EF', color: 'sky', glasses: undefined }))
      .toBe(canonicalKunAvatarKey(normalizeKunAvatarParts()))
    expect(canonicalKunAvatarKey(normalizeKunAvatarParts({ face: 'happy' })))
      .not.toBe(canonicalKunAvatarKey(normalizeKunAvatarParts()))
  })

  it('keeps random combinations valid and respects every pair of accessory slots', () => {
    let seed = 7
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
    for (let index = 0; index < 1000; index++) {
      expect(KunAvatarPartsSchema.safeParse(randomKunAvatarParts(random)).success).toBe(true)
    }
    for (const [index, category] of KUN_AVATAR_ACCESSORY_CATEGORIES.entries()) {
      for (const other of KUN_AVATAR_ACCESSORY_CATEGORIES.slice(index + 1)) {
        for (const part of KUN_AVATAR_CATALOG[category]) for (const otherPart of KUN_AVATAR_CATALOG[other]) {
          const parts = normalizeKunAvatarParts({ [category]: part.id, [other]: otherPart.id })
          const expectedConflict = category === 'headwear' && other === 'glasses' && part.id === 'astronaut-helmet'
          expect(getKunAvatarConflicts(parts).length > 0).toBe(expectedConflict)
          expect(KunAvatarPartsSchema.safeParse(parts).success).toBe(!expectedConflict)
        }
      }
    }
  })
})
