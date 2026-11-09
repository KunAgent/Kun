import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BUILTIN_PET_IDS } from './pets-builtin'
import { parsePetInteractionPack } from './pets-interactions'
import { jointSceneFor, parsePetJointRig } from './pets-joint'

const packages = BUILTIN_PET_IDS.map((id) => JSON.parse(readFileSync(`resources/pets/${id}/pet.json`, 'utf8')))
describe('joint character packs', () => {
  it('ships independent rig anchors for exactly Kun, iKun and DS', () => {
    expect(BUILTIN_PET_IDS).toEqual(['xiao-kun', 'ikun', 'whale-girl'])
    expect(new Set(packages.map((p) => JSON.stringify(p.interactions.joint.arms))).size).toBe(3)
    for (const pet of packages) {
      const pack = parsePetInteractionPack(pet.interactions)!
      expect(pack.joint).toEqual(pet.interactions.joint)
      expect(pack.joint).not.toBe(pet.interactions.joint)
    }
  })
  it('rejects invalid anchors and keeps executable or arbitrary fields out of the bridge', () => {
    const valid = packages[0].interactions.joint
    expect(parsePetJointRig({ ...valid, url: 'https://invalid', script: 'code' })).toEqual(valid)
    for (const patch of [{ row: -1 }, { blink: [0, 1] }, { blink: [0, 1, 2, 3, 4, 99] },
      { ground: Infinity }, { head: [1e6, .5] }, { arms: [] }, { feet: [[.5, .9]] },
      { arms: [{ shoulder: [.5, .5], hand: [.5, .5], radius: .1 }, valid.arms[1]] }]) {
      expect(parsePetJointRig({ ...valid, ...patch })).toBeNull()
      expect(parsePetInteractionPack({ ...packages[0].interactions, joint: { ...valid, ...patch } })).toBeNull()
    }
  })
  it('maps saved activities to the supported shared scenes', () => {
    expect(jointSceneFor('high-five')).toBe('dance')
    expect(jointSceneFor('study')).toBe('bubbles')
    expect(jointSceneFor('coding')).toBe('cheer')
    expect(jointSceneFor('race')).toBe('beatbox')
  })
})
