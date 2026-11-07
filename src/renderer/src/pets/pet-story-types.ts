import type { PetAnimationState, PetSummary } from '@shared/pets'
import type { PetSceneId } from '@shared/pets-ensemble'
import { PET_SCENE_DIRECTORS } from './pet-ensemble-catalog'

export type StoryActor = {
  x: number; y: number; size: number; scale: number; pose: PetAnimationState
  poseTime: number; frame?: number; facing: number; tilt: number; lift: number; opacity: number
}
export type StoryPropKind = 'ball' | 'book' | 'page' | 'table' | 'cup' | 'pot' | 'gift' | 'ribbon' |
  'bulb' | 'computer' | 'brick' | 'bug' | 'net' | 'star' | 'moon' | 'bubble' | 'wand' | 'note' | 'drum' |
  'flag' | 'baton' | 'bush' | 'spark' | 'heart' | 'plant' | 'constellation'
export type StoryProp = {
  id: string; kind: StoryPropKind; x: number; y: number; size: number; rotation: number
  scale: number; opacity: number; detail: number; behind: boolean
}
export type StoryFrame = { actors: StoryActor[]; props: StoryProp[]; beat: [string, string] }
export type StoryInput = {
  scene: PetSceneId; cast: PetSummary[]; progress: number; duration: number; width: number; height: number; mascotWidth: number
}
export type StoryContext = StoryInput & StoryFrame & {
  host: StoryActor; lead: StoryActor; leadIndex: number; p: number; w: number; h: number
}

export const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const smooth = (t: number): number => { const v = clamp(t); return v * v * (3 - 2 * v) }
export const cue = (p: number, from: number, to: number): number => smooth((p - from) / (to - from))
export const arc = (p: number, from: number, to: number): number => p <= from || p >= to ? 0 : Math.sin((p - from) / (to - from) * Math.PI)
export const body = (actor: StoryActor): number => actor.size * actor.scale
export const hand = (actor: StoryActor, side = actor.facing): { x: number; y: number } => ({ x: actor.x + side * body(actor) * .27, y: actor.y + body(actor) * .12 - actor.lift })
export const foot = (actor: StoryActor): number => actor.y + body(actor) * .45 - actor.lift

export function gesture(c: StoryContext, actor: StoryActor, pose: PetAnimationState, from: number, to: number): void {
  if (c.p < from || c.p >= to) return
  actor.pose = pose
  actor.poseTime = (c.p - from) * c.duration
}

export function celebrate(c: StoryContext, from = .82): void {
  c.actors.forEach((actor, index) => {
    const start = from + index * .015
    gesture(c, actor, 'jumping', start, Math.min(1, start + .13))
    actor.lift += arc(c.p, start, Math.min(1, start + .13)) * (index < 2 ? 10 : 6)
  })
}

export function prop(c: StoryContext, id: string, kind: StoryPropKind, x: number, y: number, size: number,
  options: Partial<Omit<StoryProp, 'id' | 'kind' | 'x' | 'y' | 'size'>> = {}): StoryProp {
  const value = { id, kind, x, y, size, rotation: 0, scale: 1, opacity: 1, detail: 0, behind: false, ...options }
  c.props.push(value)
  return value
}

export function beat(c: StoryContext, entries: Array<[number, string, string]>): void {
  const current = entries.filter(([start]) => c.p >= start).at(-1) ?? entries[0]
  c.beat = [current[1], current[2]]
}

export function makeStoryContext(input: StoryInput): StoryContext {
  const { width: w, height: h, cast, mascotWidth } = input
  const director = PET_SCENE_DIRECTORS[input.scene]
  const leadIndex = Math.max(1, cast.findIndex((pet, i) => i > 0 && pet.sourceId === director))
  let spectator = 0
  const actors = cast.map((_, index): StoryActor => {
    const host = index === 0, lead = index === leadIndex
    const size = host ? mascotWidth : Math.min(88, mascotWidth * .85, w * .23, h * .30)
    const playSize = host ? Math.min(124, size, w * .29, h * .40) : size * (lead ? 1 : .82)
    const floor = h * .80 - (host || lead ? 0 : 12 + spectator * 6)
    const position = { x: (host ? .30 : lead ? .70 : spectator++ % 2 === 0 ? .12 : .88) * w,
      y: floor - playSize * .45 }
    return { ...position, size, scale: playSize / size, pose: 'idle', poseTime: input.progress * input.duration,
      facing: position.x < w / 2 ? 1 : -1, tilt: 0, lift: 0, opacity: 1 }
  })
  return { ...input, w, h, p: clamp(input.progress), actors, host: actors[0], lead: actors[leadIndex] ?? actors[0], leadIndex,
    props: [], beat: ['', ''] }
}
