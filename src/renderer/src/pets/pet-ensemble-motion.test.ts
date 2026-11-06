import { describe, expect, it } from 'vitest'
import { BUILTIN_PET_IDS } from '@shared/pets-builtin'
import { defaultPetEnsemble, parsePetEnsemble, PET_SCENE_IDS } from '@shared/pets-ensemble'
import { PET_ROWS } from '@shared/pets'
import { PET_ENSEMBLE_PRESETS, PET_PERSONAS, PET_SCENES } from './pet-ensemble-catalog'
import { ensembleActorRect, ensembleActorSize, ensembleSceneAt, samplePetEnsemble } from './pet-ensemble-motion'
import { petSurfaceLayout } from './pet-layout'

describe('coordinated companion scenes', () => {
  it('offers themed casts covering every built-in, and gives a present AI director a specific role', () => {
    expect(new Set(PET_ENSEMBLE_PRESETS.flatMap((preset) => preset.members)).size).toBe(17)
    for (const preset of PET_ENSEMBLE_PRESETS) {
      expect(parsePetEnsemble({ ...defaultPetEnsemble(), members: preset.members, scene: preset.scene })).not.toBeNull()
    }
    const frame = samplePetEnsemble({ ...defaultPetEnsemble(), members: ['xiao-kun', 'doubao-girl', 'gpt-girl'], scene: 'tea' }, 0)
    expect(frame.actors.find((actor) => actor.id === 'doubao-girl')?.pose).toBe('waving')
    expect(frame.actors.find((actor) => actor.id === 'gpt-girl')?.pose).toBe('waiting')
  })

  it('supports all 24 scenes at small and full-cast sizes without clipping any sprite', () => {
    for (const members of [['xiao-kun', 'gpt-girl'] as const, BUILTIN_PET_IDS]) {
      for (const scene of PET_SCENE_IDS) {
        const settings = { ...defaultPetEnsemble(), members: [...members], scene }
        for (let tick = 0; tick < 50; tick++) {
          const frame = samplePetEnsemble(settings, PET_SCENES[scene].duration * tick / 50)
          expect(frame.actors).toHaveLength(members.length)
          expect(frame.actors.filter((actor) => actor.featured)).toHaveLength(1)
          for (const width of [280, 404]) {
            const size = ensembleActorSize(members.length, width, 260)
            for (const actor of frame.actors) {
              expect(PET_ROWS[actor.pose].frames).toBeGreaterThan(0)
              const rect = ensembleActorRect(actor, size, width, 260)
              expect(rect.left).toBeGreaterThanOrEqual(0)
              expect(rect.top).toBeGreaterThanOrEqual(0)
              expect(rect.left + rect.width).toBeLessThanOrEqual(width)
              expect(rect.top + rect.height).toBeLessThanOrEqual(260)
            }
          }
        }
      }
    }
  })

  it('hands the spotlight and shared gift to different companions on a common timeline', () => {
    const settings = { ...defaultPetEnsemble(), scene: 'gift' as const }
    const a = samplePetEnsemble(settings, 0)
    const b = samplePetEnsemble(settings, 4000)
    const traveling = samplePetEnsemble(settings, 3400)
    expect(a.actors.find((actor) => actor.featured)?.id).toBe('xiao-kun')
    expect(b.actors.find((actor) => actor.featured)?.id).toBe('whale-girl')
    expect(traveling.token.x).toBeGreaterThan(a.token.x)
    expect(traveling.token.x).toBeLessThan(b.token.x)
  })

  it('uses distinct choreography and character signatures', () => {
    const motions = PET_SCENE_IDS.map((scene) => JSON.stringify([.27, .64, .92].map((p) =>
      samplePetEnsemble({ ...defaultPetEnsemble(), scene }, PET_SCENES[scene].duration * p).actors)))
    expect(new Set(motions).size).toBe(24)
    expect(Object.keys(PET_PERSONAS).sort()).toEqual([...BUILTIN_PET_IDS].sort())
    expect(PET_PERSONAS['claude-girl'].motif).toBe('book')
    expect(PET_PERSONAS['kimi-girl'].motif).toBe('moon')
    expect(PET_PERSONAS['whale-girl'].motif).toBe('bubble')
  })

  it('cycles scenes deterministically, wraps the playlist, and keeps reduced motion still', () => {
    const settings = { ...defaultPetEnsemble(), autoplay: true }
    expect(ensembleSceneAt(settings, 12000)).toEqual({ scene: 'high-five', elapsed: 0 })
    const duration = PET_SCENE_IDS.reduce((total, id) => total + PET_SCENES[id].duration, 0)
    expect(ensembleSceneAt(settings, duration + 12000)).toEqual({ scene: 'high-five', elapsed: 0 })
    expect(samplePetEnsemble(settings, 0, true)).toEqual(samplePetEnsemble(settings, 45678, true))
    expect(samplePetEnsemble(settings, 500, true).token.visible).toBe(false)
  })

  it('keeps the group stage and controls inside the native canvas near every screen edge', () => {
    for (const anchorX of [12, 210, 408]) for (const anchorY of [12, 320, 628]) {
      const layout = petSurfaceLayout({ anchor: { anchorX, anchorY, viewportWidth: 420, viewportHeight: 640 },
        petWidth: 112, petSize: { width: 404, height: 260 }, controls: { width: 220, height: 44 },
        notification: { width: 330, height: 80 }, menu: { width: 160, height: 110 } })
      for (const rect of [layout.pet, layout.controls, layout.menu]) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(rect.left + rect.width).toBeLessThanOrEqual(420)
        expect(rect.top + rect.height).toBeLessThanOrEqual(640)
      }
    }
  })
})
