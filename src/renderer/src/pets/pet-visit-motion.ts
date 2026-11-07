import type { PetSummary } from '@shared/pets'
import { PET_VISIT_ARRIVAL_MS, type PetVisit } from '@shared/pets-visits'
import { PET_SCENES } from './pet-ensemble-catalog'
import { samplePetStory } from './pet-storyboard'
import { clamp, lerp, smooth, type StoryActor } from './pet-story-types'

export type VisitActorFrame = StoryActor

/** Entrances and exits wrap the scene; interruption freezes its current contact points. */
export function samplePetVisit(input: {
  visit: PetVisit; now: number; cast: PetSummary[]; width: number; height: number
  primaryOrigin: { x: number; y: number }; mascotWidth: number; reduced: boolean
}) {
  const { visit, now, cast, width, height, reduced } = input
  const arriveEnd = visit.startedAt + PET_VISIT_ARRIVAL_MS
  const departing = now >= visit.playUntil
  const entering = !departing && now < arriveEnd
  const phase = departing ? 'departing' : entering ? 'arriving' : 'playing'
  const entry = smooth((now - visit.startedAt) / PET_VISIT_ARRIVAL_MS)
  const exit = smooth((now - visit.playUntil) / Math.max(1, visit.endsAt - visit.playUntil))
  const play = clamp((Math.min(now, visit.playUntil) - arriveEnd) / Math.max(1, visit.plannedPlayUntil - arriveEnd))
  const story = samplePetStory({ scene: visit.scene, cast, width, height, mascotWidth: input.mascotWidth,
    progress: reduced ? .45 : play, duration: PET_SCENES[visit.scene].duration })
  const actors = story.actors.map((frame, index): VisitActorFrame => {
    const host = index === 0
    const entryLeft = (index + Math.floor(visit.seed * 7)) % 2 === 0
    const arrival = cast[index].interactions?.visits?.arrival ?? 'walk'
    const start = host ? input.primaryOrigin : { x: entryLeft ? -frame.size : width + frame.size,
      y: frame.y + (arrival === 'peek' ? 25 : 0) }
    const actor = { ...frame }
    const enteringAtExit = smooth((visit.playUntil - visit.startedAt) / PET_VISIT_ARRIVAL_MS)
    const arrivalProgress = departing ? enteringAtExit : entry
    if (entering || (departing && enteringAtExit < 1)) {
      actor.x = lerp(start.x, frame.x, arrivalProgress)
      actor.y = lerp(start.y, frame.y, arrivalProgress)
      actor.opacity = host ? 1 : arrivalProgress
      actor.scale = host ? lerp(1, frame.scale, arrivalProgress) : frame.scale
      actor.pose = host ? 'waving' : arrival === 'hop' ? 'jumping' : entryLeft ? 'running-right' : 'running-left'
      actor.frame = undefined
      actor.facing = 1 // Direction is already encoded in the walking sprite row.
      actor.poseTime = Math.max(0, Math.min(now, visit.playUntil) - visit.startedAt)
      actor.lift = arrival === 'hop' && !host ? Math.sin(arrivalProgress * Math.PI) * 14 : 0
      actor.tilt = 0
    }
    if (departing) {
      actor.frame = undefined
      actor.x = lerp(actor.x, start.x, exit)
      actor.y = lerp(actor.y, start.y, exit)
      actor.opacity *= host ? 1 : 1 - exit
      actor.scale = host ? lerp(actor.scale, 1, exit) : actor.scale
      actor.tilt *= 1 - exit
      actor.lift *= 1 - exit
      actor.pose = exit < .3 ? 'waving' : host ? 'idle' : entryLeft ? 'running-left' : 'running-right'
      actor.facing = 1
      actor.poseTime = Math.max(0, now - visit.playUntil)
    }
    if (reduced) {
      actor.x = host ? input.primaryOrigin.x : frame.x
      actor.y = host ? input.primaryOrigin.y : frame.y
      actor.opacity = now >= visit.endsAt && !host ? 0 : 1
      actor.pose = 'idle'; actor.poseTime = 0; actor.tilt = 0; actor.lift = 0; actor.scale = host ? 1 : frame.scale
    }
    return actor
  })
  const opacity = reduced ? 1 : entering ? entry : departing ? 1 - exit : 1
  return { phase, actors, props: story.props.map((prop) => ({ ...prop, opacity: prop.opacity * opacity })),
    beat: story.beat, progress: clamp((now - visit.startedAt) / (visit.endsAt - visit.startedAt)) }
}
