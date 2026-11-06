import type { PetAnimationState, PetSummary } from '@shared/pets'
import { isBuiltinPetId } from '@shared/pets-builtin'
import { defaultPetEnsemble } from '@shared/pets-ensemble'
import { PET_VISIT_ARRIVAL_MS, type PetVisit } from '@shared/pets-visits'
import { PET_SCENES } from './pet-ensemble-catalog'
import { samplePetEnsemble } from './pet-ensemble-motion'

const clamp = (x: number, min = 0, max = 1): number => Math.max(min, Math.min(max, x))
const ease = (p: number): number => { const x = clamp(p); return x * x * (3 - 2 * x) }
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const TAU = Math.PI * 2

export type VisitActorFrame = { x: number; y: number; size: number; pose: PetAnimationState; opacity: number; tilt: number; lift: number; scale: number }

/** The host starts/finishes at its saved position; guests arrive, play, and leave. */
export function samplePetVisit(input: {
  visit: PetVisit; now: number; cast: PetSummary[]; width: number; height: number
  primaryOrigin: { x: number; y: number }; mascotWidth: number; reduced: boolean
}) {
  const { visit, now, cast, width, height, reduced } = input
  const arriveEnd = visit.startedAt + PET_VISIT_ARRIVAL_MS
  const departing = now >= visit.playUntil
  const entering = !departing && now < arriveEnd
  const phase = departing ? 'departing' : entering ? 'arriving' : 'playing'
  const entry = ease((now - visit.startedAt) / Math.max(1, arriveEnd - visit.startedAt))
  const exit = ease((now - visit.playUntil) / Math.max(1, visit.endsAt - visit.playUntil))
  const play = clamp((Math.min(now, visit.playUntil) - arriveEnd) / Math.max(1, visit.plannedPlayUntil - arriveEnd), 0, .999)
  const members = cast.map((pet) => isBuiltinPetId(pet.sourceId) ? pet.sourceId : 'xiao-kun')
  const script = samplePetEnsemble({ ...defaultPetEnsemble(), members, scene: visit.scene }, play * PET_SCENES[visit.scene].duration, reduced)
  const traveling = ['circle-dance', 'conga', 'chase', 'race'].includes(visit.scene)
  const actors: VisitActorFrame[] = cast.map((pet, index) => {
    const host = index === 0
    const guestCount = cast.length - 1
    const home = host ? { x: .5, y: .66 } : guestCount === 1 ? { x: .67, y: .51 }
      : index === 1 ? { x: .23, y: .47 } : index === 2 ? { x: .77, y: .44 } : { x: .5, y: .22 }
    if (host && guestCount === 1) { home.x = .42; home.y = .63 }
    const size = host ? input.mascotWidth : Math.min(88, input.mascotWidth * .85)
    const playSize = host ? Math.min(124, size) : size
    const motion = script.actors.find((actor) => actor.id === members[index]) ?? script.actors[index]
    let x = home.x, y = home.y
    if (traveling && !reduced) {
      const angle = play * TAU + index / cast.length * TAU + visit.seed * .5
      const blend = Math.sin(play * Math.PI)
      x = lerp(home.x, .5 + Math.cos(angle) * .31, blend)
      y = lerp(home.y, .46 + Math.sin(angle) * .24, blend)
    } else if (!reduced && !host && ['high-five', 'gift', 'wave-relay'].includes(visit.scene)) {
      const pulse = Math.max(0, Math.sin(play * TAU - index))
      x = lerp(x, home.x < .5 ? .35 : .65, pulse * .45)
      y = lerp(y, .6, pulse * .4)
    }
    let target = { x: clamp(x * width, playSize / 2 + 6, width - playSize / 2 - 6),
      y: clamp(y * height, playSize * 208 / 384 + 32, height - playSize * 208 / 384 - 12) }
    const entryLeft = (index + Math.floor(visit.seed * 7)) % 2 === 0
    const arrival = pet.interactions?.visits?.arrival ?? 'walk'
    const start = host ? input.primaryOrigin : { x: entryLeft ? -size : width + size, y: target.y + (arrival === 'peek' ? 35 : 0) }
    let opacity = 1, pose = motion?.pose ?? 'idle', tilt = motion?.tilt ?? 0, lift = motion?.lift ?? 0
    let scale = host ? playSize / size : 1
    if (entering) {
      target = { x: lerp(start.x, target.x, entry), y: lerp(start.y, target.y, entry) }
      opacity = host ? 1 : entry
      scale = host ? lerp(1, scale, entry) : scale
      pose = host ? 'waving' : arrival === 'hop' ? 'jumping' : entryLeft ? 'running-right' : 'running-left'
      lift = arrival === 'hop' && !host ? Math.sin(entry * Math.PI) * 18 : 0
      tilt = 0
    } else if (departing) {
      const entered = ease((visit.playUntil - visit.startedAt) / PET_VISIT_ARRIVAL_MS)
      target = { x: lerp(start.x, target.x, entered), y: lerp(start.y, target.y, entered) }
      if (host) scale = lerp(1, scale, entered)
      target = { x: lerp(target.x, start.x, exit), y: lerp(target.y, start.y, exit) }
      opacity = host ? 1 : (1 - exit) * entered
      scale = host ? lerp(scale, 1, exit) : scale
      pose = exit < .3 ? 'waving' : host ? 'idle' : entryLeft ? 'running-left' : 'running-right'
      tilt = (visit.playUntil < arriveEnd ? 0 : motion?.tilt ?? 0) * (1 - exit)
      lift = (visit.playUntil < arriveEnd
        ? arrival === 'hop' && !host ? Math.sin(entered * Math.PI) * 18 : 0
        : motion?.lift ?? 0) * (1 - exit)
    }
    if (reduced) {
      target = host ? input.primaryOrigin : { x: home.x * width, y: home.y * height }
      opacity = now >= visit.endsAt && !host ? 0 : 1
      pose = 'idle'; tilt = 0; lift = 0; scale = host ? 1 : scale
    }
    return { ...target, size, pose, opacity, tilt, lift, scale }
  })
  const turn = play * cast.length
  const from = actors[Math.min(actors.length - 1, Math.floor(turn))]
  const to = actors[(Math.floor(turn) + 1) % actors.length]
  const pass = ease(clamp(((turn % 1) - .4) / .6))
  const token = !reduced && phase === 'playing' && cast.length > 1 ? {
    x: lerp(from.x, to.x, pass),
    y: Math.max(48, lerp(from.y - from.size * .58, to.y - to.size * .58, pass) - Math.sin(pass * Math.PI) * 14),
    motif: PET_SCENES[visit.scene].motif
  } : null
  return { phase, actors, token, progress: clamp((now - visit.startedAt) / (visit.endsAt - visit.startedAt)) }
}
