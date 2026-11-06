import type { PetAnimationState } from '@shared/pets'
import { isKunPetId, type BuiltinPetId } from '@shared/pets-builtin'
import { PET_SCENE_IDS, type PetEnsembleSettings, type PetSceneId } from '@shared/pets-ensemble'
import { PET_PERSONAS, PET_SCENES, PET_SCENE_DIRECTORS, type PetMotif } from './pet-ensemble-catalog'

type Point = { x: number; y: number }
export type EnsembleActor = Point & {
  id: BuiltinPetId; pose: PetAnimationState; tilt: number; lift: number; scale: number; featured: boolean
}
export type EnsembleFrame = {
  scene: PetSceneId; elapsed: number; actors: EnsembleActor[]
  token: Point & { motif: PetMotif; visible: boolean }
  progress: number
}

const TAU = Math.PI * 2
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p
const ease = (p: number): number => p * p * (3 - 2 * p)

export function ensembleSceneAt(settings: PetEnsembleSettings, elapsed: number): { scene: PetSceneId; elapsed: number } {
  let remaining = Math.max(0, elapsed)
  if (!settings.autoplay) return { scene: settings.scene, elapsed: remaining % PET_SCENES[settings.scene].duration }
  const cycle = PET_SCENE_IDS.reduce((sum, id) => sum + PET_SCENES[id].duration, 0)
  remaining %= cycle
  let index = PET_SCENE_IDS.indexOf(settings.scene)
  while (remaining >= PET_SCENES[PET_SCENE_IDS[index]].duration) {
    remaining -= PET_SCENES[PET_SCENE_IDS[index]].duration
    index = (index + 1) % PET_SCENE_IDS.length
  }
  return { scene: PET_SCENE_IDS[index], elapsed: remaining }
}

function home(index: number, count: number): Point {
  const columns = count <= 4 ? count : count <= 8 ? 4 : count <= 12 ? 4 : 5
  const rows = Math.ceil(count / columns)
  const row = Math.floor(index / columns)
  const inRow = Math.min(columns, count - row * columns)
  return { x: (index % columns + 1) / (inRow + 1), y: rows === 1 ? .58 : .25 + row * .5 / (rows - 1) }
}

/** A single shared timeline coordinates the actors and the prop they pass. */
export function samplePetEnsemble(settings: PetEnsembleSettings, milliseconds: number, reduced = false): EnsembleFrame {
  const current = ensembleSceneAt(settings, reduced ? 0 : milliseconds)
  const { scene, elapsed } = current
  const p = elapsed / PET_SCENES[scene].duration
  const members = [...settings.members].sort((a, b) => Number(isKunPetId(b)) - Number(isKunPetId(a)))
  const count = members.length
  const turn = p * count
  const focus = Math.min(count - 1, Math.floor(turn))
  const beat = turn % 1
  const pulse = Math.sin(beat * Math.PI)
  const finale = p > .85
  const actors: EnsembleActor[] = members.map((id, index) => {
    const origin = home(index, count)
    const featured = index === focus
    const host = isKunPetId(id)
    const director = id === PET_SCENE_DIRECTORS[scene]
    const persona = PET_PERSONAS[id]
    // Identity-specific timing and gestures prevent a row of identical clones.
    const signature = Object.keys(PET_PERSONAS).indexOf(id)
    const wave = Math.sin(p * TAU * 4 + index * .65 + signature * .13)
    const actor: EnsembleActor = { ...origin, id, pose: 'idle', tilt: 0, lift: 0, scale: 1, featured }
    switch (scene) {
      case 'welcome':
        actor.pose = host ? 'waving' : featured ? persona.pose : 'idle'
        actor.lift = featured ? pulse * 9 : 0
        break
      case 'high-five': {
        const hostPosition = home(0, count)
        actor.pose = featured || index === 0 ? 'waving' : 'waiting'
        if (featured && index > 0) {
          actor.x = lerp(origin.x, hostPosition.x + .17, pulse * .8)
          actor.y = lerp(origin.y, hostPosition.y, pulse * .8)
          actor.lift = pulse * 12
        }
        break
      }
      case 'wave-relay':
        actor.pose = featured ? 'waving' : 'idle'
        actor.tilt = featured ? wave * 9 : 0
        break
      case 'cheer':
        actor.pose = p < .2 ? 'waiting' : finale || featured ? 'jumping' : 'waving'
        actor.lift = finale ? Math.abs(wave) * 18 : featured ? pulse * 14 : 0
        break
      case 'dance':
        actor.pose = host || p > index / count * .5 ? 'jumping' : 'waiting'
        actor.tilt = wave * 10
        actor.x += wave * .025
        break
      case 'circle-dance': {
        const angle = index / count * TAU + p * TAU
        actor.x = .5 + Math.cos(angle) * .34
        actor.y = .49 + Math.sin(angle) * .28
        actor.pose = Math.sin(angle) > 0 ? 'running-left' : 'running-right'
        actor.tilt = wave * 6
        break
      }
      case 'conga': {
        const angle = p * TAU - index / count * TAU
        actor.x = .5 + Math.sin(angle) * .35
        actor.y = .47 + Math.sin(angle * 2) * .22
        actor.pose = Math.cos(angle) > 0 ? 'running-right' : 'running-left'
        actor.lift = Math.abs(wave) * 5
        break
      }
      case 'chase':
        actor.x += Math.sin(p * TAU * 2 - index * .4) * .06
        actor.pose = Math.cos(p * TAU * 2 - index * .4) > 0 ? 'running-right' : 'running-left'
        actor.lift = featured ? 10 * pulse : 0
        break
      case 'race':
        actor.pose = featured ? (beat < .5 ? 'running-right' : 'running-left') : 'waving'
        actor.x += featured ? Math.sin(beat * TAU) * .12 : 0
        break
      case 'hide-and-seek':
        actor.pose = featured ? 'waving' : host ? 'waiting' : 'idle'
        actor.scale = featured || host ? 1 : .78
        actor.tilt = featured ? Math.sin(beat * TAU) * 14 : 0
        break
      case 'leapfrog':
        actor.pose = featured ? 'jumping' : 'waiting'
        actor.lift = featured ? pulse * 32 : 0
        break
      case 'exercise':
        actor.pose = p < .65 ? 'waving' : 'jumping'
        actor.tilt = Math.sin(p * TAU * 2) * 14
        actor.lift = p > .65 ? Math.abs(wave) * 12 : 0
        break
      case 'brainstorm':
        actor.pose = host ? 'review' : director || featured ? persona.pose : 'waiting'
        actor.lift = featured ? pulse * 8 : 0
        break
      case 'coding':
        actor.pose = p < .15 ? (host ? 'waving' : 'waiting') : finale ? 'jumping' : 'running'
        actor.tilt = finale ? wave * 6 : Math.sin(p * TAU * 8 + signature) * 2
        break
      case 'debug':
        actor.pose = finale ? 'jumping' : featured ? 'failed' : 'review'
        actor.tilt = featured && !finale ? wave * 7 : 0
        break
      case 'review':
        actor.pose = featured ? 'review' : 'waving'
        actor.scale = featured ? 1.06 : .97
        break
      case 'study':
        actor.pose = director || featured ? 'review' : 'waiting'
        actor.tilt = featured ? Math.sin(beat * TAU) * 3 : 0
        break
      case 'orchestra':
        actor.pose = host || director ? 'waving' : finale || featured ? persona.pose : 'waiting'
        actor.tilt = host || director || finale || featured ? wave * 8 : 0
        break
      case 'beatbox':
        actor.pose = featured ? 'jumping' : 'waving'
        actor.lift = Math.max(0, Math.sin(p * TAU * 10 + signature)) * (featured ? 20 : 5)
        actor.tilt = featured ? wave * 12 : wave * 3
        break
      case 'gift':
        actor.pose = featured ? 'jumping' : 'waiting'
        actor.lift = featured ? pulse * 10 : 0
        break
      case 'tea':
        actor.pose = director || featured ? 'waving' : 'waiting'
        actor.tilt = featured ? pulse * 5 : 0
        break
      case 'stargazing':
        actor.pose = director ? 'waving' : featured ? persona.pose : 'waiting'
        actor.lift = Math.sin(p * TAU + signature * .4) * 3
        break
      case 'bubbles':
        actor.pose = host || director ? 'waving' : featured ? 'jumping' : 'idle'
        actor.lift = featured ? pulse * 22 : 0
        break
      case 'finale':
        actor.pose = finale ? 'waving' : featured ? 'review' : 'idle'
        actor.tilt = featured && !finale ? pulse * 13 : 0
        actor.scale = featured ? 1 + pulse * .05 : 1
        break
    }
    if (reduced) return { ...actor, ...origin, pose: persona.pose, tilt: 0, lift: 0, scale: 1 }
    return { ...actor, x: clamp(actor.x, .08, .92), y: clamp(actor.y, .15, .82) }
  })
  const from = actors[focus] ?? { x: .5, y: .5 }
  const to = actors[(focus + 1) % count] ?? from
  const passing = ['wave-relay', 'gift', 'race', 'tea', 'orchestra', 'debug'].includes(scene)
  const travel = ease(clamp((beat - .55) / .45, 0, 1))
  const token = {
    x: passing ? lerp(from.x, to.x, travel) : from.x,
    y: Math.max(.08, (passing ? lerp(from.y, to.y, travel) : from.y) - .2 - Math.sin(travel * Math.PI) * .09),
    motif: ['welcome', 'brainstorm', 'gift'].includes(scene) && members[focus]
      ? PET_PERSONAS[members[focus]].motif : PET_SCENES[scene].motif,
    visible: !reduced
  }
  return { ...current, actors, token, progress: p }
}

export function ensembleActorSize(count: number, width: number, height: number, preferred = 112): number {
  const columns = count <= 4 ? Math.max(1, count) : count <= 12 ? 4 : 5
  const rows = Math.ceil(Math.max(1, count) / columns)
  return Math.max(20, Math.min(preferred, count <= 4 ? 88 : count <= 8 ? 72 : count <= 12 ? 56 : 44,
    (width - 24) / (columns + 1), (height - 48) / (rows + 1)))
}

export function ensembleActorRect(actor: EnsembleActor, size: number, width: number, height: number) {
  const h = size * 208 / 192
  return {
    left: clamp(actor.x * width - size / 2, 6, width - size - 6),
    top: clamp(actor.y * height - h / 2 - actor.lift, 24, height - h - 20), width: size, height: h
  }
}
