import { describe, expect, it } from 'vitest'
import { PET_ROWS, type PetSummary } from '@shared/pets'
import { PET_SCENE_IDS, type PetSceneId } from '@shared/pets-ensemble'
import { PET_SCENES } from './pet-ensemble-catalog'
import { samplePetStory } from './pet-storyboard'
import { hand } from './pet-story-types'
import { petSurfaceLayout } from './pet-layout'

const pets = (ids = ['xiao-kun', 'gpt-girl', 'claude-girl', 'ikun']): PetSummary[] => ids.map((id) => ({
  id: `kun:${id}`, sourceId: id, displayName: id, description: '', source: 'kun-builtin',
  available: true, sourceMissing: false, spriteVersionNumber: 1
}))
const sample = (scene: PetSceneId, progress: number, cast = pets(), width = 404, mascotWidth = 112) => samplePetStory({
  scene, progress, cast, width, height: 300, mascotWidth, duration: PET_SCENES[scene].duration
})

function near(a: { x: number; y: number }, b: { x: number; y: number }): void {
  expect(a.x).toBeCloseTo(b.x, 4); expect(a.y).toBeCloseTo(b.y, 4)
}

describe('authored pet stories', () => {
  it.each(PET_SCENE_IDS)('keeps %s bounded with stable objects and complete beats for two to four pets', (scene) => {
    for (const count of [2, 3, 4]) for (const width of [280, 404]) {
      const cast = pets().slice(0, count), initial = sample(scene, 0, cast, width)
      const plan = initial.props.map(({ id, kind }) => ({ id, kind }))
      const beats = new Set<string>()
      for (let i = 0; i <= 100; i++) {
        const frame = sample(scene, i / 100, cast, width, i % 2 ? 224 : 80)
        expect(frame.props.map(({ id, kind }) => ({ id, kind }))).toEqual(plan)
        expect(frame.actors).toHaveLength(count)
        beats.add(frame.beat[0])
        for (const actor of frame.actors) {
          expect(PET_ROWS[actor.pose]).toBeDefined()
          const halfWidth = actor.size * actor.scale / 2
          expect(actor.x - halfWidth).toBeGreaterThanOrEqual(0)
          expect(actor.x + halfWidth).toBeLessThanOrEqual(width)
          expect(actor.y - halfWidth * 208 / 192 - actor.lift).toBeGreaterThanOrEqual(30)
          expect(actor.y + halfWidth * 208 / 192).toBeLessThanOrEqual(300)
        }
        for (const object of frame.props) {
          for (const field of ['x', 'y', 'opacity', 'rotation', 'scale', 'size', 'detail'] as const) expect(Number.isFinite(object[field])).toBe(true)
          expect(object.opacity).toBeGreaterThanOrEqual(0)
          expect(object.opacity).toBeLessThanOrEqual(1)
        }
      }
      expect(beats.size).toBeGreaterThanOrEqual(3)
    }
  })

  it('does not teleport bodies or visible props at story beat boundaries', () => {
    for (const scene of PET_SCENE_IDS) {
      let previous = sample(scene, 0)
      for (let step = 1; step <= 500; step++) {
        const current = sample(scene, step / 500)
        current.actors.forEach((actor, i) => {
          expect(Math.hypot(actor.x - previous.actors[i].x, actor.y - previous.actors[i].y), `${scene} actor ${i} at ${step}`).toBeLessThan(12)
        })
        current.props.forEach((object, i) => {
          if (object.opacity < .1 || previous.props[i].opacity < .1) return
          expect(Math.hypot(object.x - previous.props[i].x, object.y - previous.props[i].y), `${scene} ${object.id} at ${step}`).toBeLessThan(15)
        })
        previous = current
      }
    }
  })

  it('throws one ball into the receiving hand, then returns it before restoring iKun’s painted-in ball', () => {
    const cast = pets(['xiao-kun', 'ikun'])
    const received = sample('beatbox', .48, cast)
    near(received.props.find((p) => p.id === 'ball')!, hand(received.actors[0]))
    expect(received.actors[1]).toMatchObject({ pose: 'failed', frame: 0 })
    const returned = sample('beatbox', .79, cast)
    near(returned.props.find((p) => p.id === 'ball')!, hand(returned.actors[1]))
    expect(sample('beatbox', .90, cast).props.find((p) => p.id === 'ball')?.opacity).toBe(0)
  })

  it('hands the present from giver to receiver and reveals a character-specific surprise', () => {
    const cast = pets(['xiao-kun', 'claude-girl'])
    const start = sample('gift', .25, cast), delivered = sample('gift', .50, cast)
    near(start.props.find((p) => p.id === 'present')!, hand(start.actors[1]))
    near(delivered.props.find((p) => p.id === 'present')!, hand(delivered.actors[0]))
    expect(sample('gift', .80, cast).props.find((p) => p.id === 'surprise')).toMatchObject({ kind: 'book', opacity: 1 })
    expect(sample('gift', .80, pets(['xiao-kun', 'gpt-girl'])).props.find((p) => p.id === 'surprise')?.kind).toBe('bulb')
  })

  it('keeps the shared book on the table while its page turns, and puts cups back after tea', () => {
    const before = sample('study', .35), turning = sample('study', .53), after = sample('study', .80)
    near(before.props.find((p) => p.id === 'book')!, after.props.find((p) => p.id === 'book')!)
    expect(turning.props.find((p) => p.id === 'page')!.opacity).toBeGreaterThan(.8)
    expect(after.props.find((p) => p.id === 'page')!.opacity).toBe(0)
    const rested = sample('tea', .48), raised = sample('tea', .64), setDown = sample('tea', .86)
    expect(raised.props.find((p) => p.id === 'cupA')!.y).toBeLessThan(rested.props.find((p) => p.id === 'cupA')!.y - 20)
    near(rested.props.find((p) => p.id === 'cupA')!, setDown.props.find((p) => p.id === 'cupA')!)
  })

  it('avoids a prop in pure greetings and keeps laptop frames out of the percussion scene', () => {
    for (const scene of ['wave-relay', 'dance', 'circle-dance', 'exercise', 'finale'] as const) expect(sample(scene, .5).props).toHaveLength(0)
    for (const progress of [.12, .33, .65]) expect(sample('orchestra', progress).actors.every((a) => a.pose !== 'running')).toBe(true)
    expect(sample('coding', .5).props.some((p) => p.kind === 'computer')).toBe(false)
  })

  it('keeps the scene and controls inside the native canvas at every screen edge', () => {
    for (const anchorX of [12, 210, 408]) for (const anchorY of [12, 320, 628]) {
      const layout = petSurfaceLayout({ anchor: { anchorX, anchorY, viewportWidth: 420, viewportHeight: 640 },
        petWidth: 112, petSize: { width: 404, height: 300 }, controls: { width: 220, height: 44 },
        notification: { width: 330, height: 80 }, menu: { width: 160, height: 110 } })
      for (const rect of [layout.pet, layout.controls, layout.menu]) {
        expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(rect.left + rect.width).toBeLessThanOrEqual(420); expect(rect.top + rect.height).toBeLessThanOrEqual(640)
      }
    }
  })
})
