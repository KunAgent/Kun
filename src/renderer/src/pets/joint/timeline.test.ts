import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PetSummary } from '@shared/pets'
import { PET_JOINT_SCENE_IDS, type PetJointSceneId } from '@shared/pets-joint'
import type { PetVisit } from '@shared/pets-visits'
import { PET_SCENES } from '../pet-ensemble-catalog'
import { bodyPoint, skinPoint } from './geometry'
import { createRigMesh, paintRigVertices } from './mesh'
import { jointHitPath, sampleJointVisit } from './timeline'

const ids = ['xiao-kun', 'ikun', 'whale-girl']
const pets = ids.map((id): PetSummary => ({ ...JSON.parse(readFileSync(`resources/pets/${id}/pet.json`, 'utf8')),
  id: `kun:${id}`, sourceId: id, source: 'kun-builtin', available: true, sourceMissing: false }))
const casts = [...pets.flatMap((a) => pets.filter((b) => b !== a).map((b) => [a, b])), pets, [pets[2], pets[0], pets[1]], [pets[1], pets[2], pets[0]]]
function input(scene: PetJointSceneId, cast = pets, progress = .5) {
  const duration = PET_SCENES[scene].duration
  const visit: PetVisit = { id: 1, scene, primaryId: cast[0].id, guestIds: cast.slice(1).map((p) => p.id),
    reason: 'manual', seed: .7, startedAt: 1000, playUntil: 2600 + duration, plannedPlayUntil: 2600 + duration, endsAt: 4200 + duration }
  return { visit, cast, width: 404, height: 300, primaryOrigin: { x: 202, y: 170 }, mascotWidth: 112,
    now: 2600 + duration * progress, reduced: false }
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('one shared pet world', () => {
  it.each(PET_JOINT_SCENE_IDS)('%s keeps every rendered hand attached to its solved contact for each pair and trio', (scene) => {
    for (const cast of casts) for (let i = 0; i <= 100; i++) {
      const frame = sampleJointVisit(input(scene, cast, i / 100))
      for (const actor of frame.actors) for (const side of [0, 1] as const) {
        expect(distance(skinPoint(actor, actor.rig.arms[side].hand), actor.hands[side])).toBeLessThan(.001)
        const shoulder = bodyPoint(actor, actor.rig.arms[side].shoulder)
        const length = distance(shoulder, bodyPoint(actor, actor.rig.arms[side].hand))
        expect(distance(shoulder, actor.hands[side]) / length, `${scene}: ${actor.pet.sourceId} at ${i}`).toBeLessThan(2.2)
      }
    }
  })

  it('joins actual rendered hands, not just two independent animation positions', () => {
    for (const cast of casts) for (const progress of [.3, .44, .57, .71]) {
      const frame = sampleJointVisit(input('dance', cast, progress))
      expect(frame.links).toHaveLength(cast.length - 1)
      for (let i = 0; i < cast.length - 1; i++) {
        const a = frame.actors[i], b = frame.actors[i + 1]
        expect(distance(skinPoint(a, a.rig.arms[1].hand), skinPoint(b, b.rig.arms[0].hand))).toBeLessThan(.001)
      }
    }
  })

  it('makes the same impact move the shared blanket, star and every participant', () => {
    const before = sampleJointVisit(input('cheer', pets, .41)), impact = sampleJointVisit(input('cheer', pets, .44))
    expect(impact.blanket!.sag).toBeGreaterThan(before.blanket!.sag)
    expect(impact.actors.every((a, i) => a.crouch > before.actors[i].crouch)).toBe(true)
    for (const point of impact.blanket!.points) {
      expect(impact.actors.some((a) => a.hands.some((hand) => distance(point, hand) < .001))).toBe(true)
    }
    const released = sampleJointVisit(input('bubbles', pets.slice(0, 2), .9))
    expect(released.actors.every((a) => a.grips.every((v) => v === 0))).toBe(true)
  })

  it.each(PET_JOINT_SCENE_IDS)('%s has continuous motion through catches, handoffs and cue boundaries', (scene) => {
    for (const cast of casts) {
      let previous = sampleJointVisit(input(scene, cast, 0))
      for (let i = 1; i <= 500; i++) {
        const frame = sampleJointVisit(input(scene, cast, i / 500))
        frame.actors.forEach((a, n) => {
          expect(distance(a.root, previous.actors[n].root)).toBeLessThan(6)
          a.hands.forEach((p, side) => expect(distance(p, previous.actors[n].hands[side]), `${scene} hand at ${i}`).toBeLessThan(7))
        })
        frame.objects.forEach((o, n) => expect(distance(o.center, previous.objects[n].center), `${scene} object at ${i}`).toBeLessThan(8))
        previous = frame
      }
    }
  })

  it.each(PET_JOINT_SCENE_IDS)('%s preserves contacts on interruption and restores the solo placement', (scene) => {
    const base = input(scene)
    for (const now of [1600, base.now]) {
      const before = sampleJointVisit({ ...base, now })
      const interrupted = { ...base, visit: { ...base.visit, playUntil: now, endsAt: now + 800 }, now }
      const after = sampleJointVisit(interrupted)
      after.actors.forEach((a, i) => {
        expect(distance(a.root, before.actors[i].root)).toBeLessThan(.001)
        a.hands.forEach((p, side) => expect(distance(p, before.actors[i].hands[side])).toBeLessThan(.001))
      })
      const end = sampleJointVisit({ ...interrupted, now: now + 800 })
      expect(end.actors[0].width).toBe(base.mascotWidth)
      expect(end.actors[0].root.x).toBe(base.primaryOrigin.x)
      expect(end.actors[0].soloBlend).toBe(1)
      expect(end.actors.slice(1).every((a) => a.opacity === 0)).toBe(true)
      expect(end.opacity).toBe(0)
    }
  })

  it('brings the ball in with its owner instead of leaving it floating at the play position', () => {
    for (const cast of casts) for (const now of [1200, 1700, 2300]) {
      const frame = sampleJointVisit({ ...input('beatbox', cast), now })
      const owner = frame.actors.find((a) => a.pet.sourceId === 'ikun') ?? frame.actors[0]
      const ball = frame.objects[0]
      expect(owner.hands.some((p) => distance(p, ball.center) < 12)).toBe(true)
    }
  })

  it('keeps reduced-motion still and produces finite GPU vertices, excluding invisible guests from hit regions', () => {
    const base = input('bubbles'), a = sampleJointVisit({ ...base, now: 3000, reduced: true }), b = sampleJointVisit({ ...base, now: 6000, reduced: true })
    expect(a.actors).toEqual(b.actors)
    expect(a.objects).toEqual(b.objects)
    for (const actor of a.actors) {
      const mesh = createRigMesh(actor.rig)
      expect(mesh.points).toContainEqual(actor.rig.arms[0].hand)
      expect([...paintRigVertices(mesh, actor, 0)].every(Number.isFinite)).toBe(true)
      expect(Math.max(...mesh.indices)).toBeLessThan(mesh.points.length)
    }
    const arriving = sampleJointVisit({ ...base, now: base.visit.startedAt })
    expect(jointHitPath(arriving).match(/M/g)).toHaveLength(1)
  })
})
