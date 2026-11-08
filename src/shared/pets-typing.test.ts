import { describe, expect, it } from 'vitest'
import { parsePetPresenceSignal } from './pets-interactions'
import { parsePetNativeActivity } from './pets-global-activity'
import { PetKeyboardState, petTypingMaskForCode, updatePetTyping } from './pets-typing'

describe('keyboard-to-paw state', () => {
  it('groups physical positions without translating characters or keyboard layouts', () => {
    expect(petTypingMaskForCode('KeyA')).toBe(1)
    expect(petTypingMaskForCode('KeyJ')).toBe(2)
    expect(petTypingMaskForCode('Space')).toBe(3)
    expect(petTypingMaskForCode('ShiftLeft')).toBe(0)
    expect(petTypingMaskForCode('Unidentified')).toBe(0)
  })
  it('retains a paw while any of its keys is held and clears all keys on reset', () => {
    const keys = new PetKeyboardState()
    expect(keys.down('KeyA')).toEqual({ held: 1, tap: 1 })
    expect(keys.down('KeyA', true)).toBeNull()
    expect(keys.down('KeyS')).toEqual({ held: 1, tap: 1 })
    expect(keys.up('KeyA')).toEqual({ held: 1, tap: 0 })
    expect(keys.down('KeyJ')).toEqual({ held: 3, tap: 2 })
    expect(keys.up('KeyS')).toEqual({ held: 2, tap: 0 })
    expect(keys.down('Space')).toEqual({ held: 3, tap: 3 })
    expect(keys.up('KeyJ')).toEqual({ held: 3, tap: 0 })
    keys.reset(); expect(keys.held).toBe(0)
    expect(keys.up('Space')).toBeNull()
  })
  it('retains short taps but does not turn held-state heartbeats into new strikes', () => {
    const down = updatePetTyping(undefined, 1, 1, 1000)
    const held = updatePetTyping(down, 1, 0, 1500)
    expect(held).toEqual(down)
    expect(updatePetTyping(held, 0, 0, 1501)).toMatchObject({ held: 0, left: { sequence: 1, struckAt: 1000, releasedAt: 1501 } })
  })
  it('strips keys and text from IPC and rejects invalid masks or sequence values', () => {
    expect(parsePetPresenceSignal({ type: 'keyboard', source: 'editor', held: 1, tap: 1, key: 'secret', text: 'private' }))
      .toEqual({ type: 'keyboard', source: 'editor', held: 1, tap: 1 })
    expect(parsePetNativeActivity('{"type":"keys","sequence":1,"held":3,"tap":3,"code":49}'))
      .toEqual({ type: 'keys', sequence: 1, held: 3, tap: 3 })
    for (const value of [-1, 4, .5, NaN, '1']) expect(parsePetPresenceSignal({ type: 'keyboard', source: 'editor', held: value, tap: 1 })).toBeNull()
    expect(parsePetNativeActivity('{"type":"keys","sequence":-1,"held":1,"tap":1}')).toBeNull()
  })
})
