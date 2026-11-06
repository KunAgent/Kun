import { describe, expect, it } from 'vitest'
import { BUILTIN_PET_IDS } from './pets-builtin'
import { defaultPetEnsemble, parsePetEnsemble, PET_SCENE_IDS } from './pets-ensemble'

describe('pet ensemble preferences', () => {
  it('accepts multiple hosts and every AI companion without sharing the caller array', () => {
    const input = { ...defaultPetEnsemble(), enabled: true, members: [...BUILTIN_PET_IDS] }
    const parsed = parsePetEnsemble(input)
    expect(parsed).toEqual(input)
    expect(parsed?.members).not.toBe(input.members)
    expect(parsed?.members).toHaveLength(17)
    expect(new Set(PET_SCENE_IDS).size).toBe(24)
  })

  it('rejects unknown members, malformed controls and casts without both a host and an AI', () => {
    for (const patch of [
      { enabled: 'true' }, { paused: 0 }, { autoplay: null }, { scene: 'unknown' },
      { members: [] }, { members: ['xiao-kun', 'ikun'] }, { members: ['gpt-girl', 'claude-girl'] },
      { members: ['xiao-kun', 'gpt-girl', 'gpt-girl'] }, { members: ['xiao-kun', 'custom-pet'] },
      { members: ['xiao-kun', 'kun-local:gpt-girl'] }, { members: Array(100).fill('gpt-girl') }
    ]) expect(parsePetEnsemble({ ...defaultPetEnsemble(), ...patch })).toBeNull()
    for (const value of [null, [], false, '{}']) expect(parsePetEnsemble(value)).toBeNull()
  })
})
