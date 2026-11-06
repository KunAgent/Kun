import { PetBottleStage } from './pet-bottle-stage'
import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { X } from 'lucide-react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetOverlayBootstrap, type PetSummary } from '@shared/pets'
import type { PetVisit } from '@shared/pets-visits'
import { frameAtElapsedMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { petEnsembleText, PET_SCENES } from './pet-ensemble-catalog'
import { usePetAnimationClock } from './use-pet-animation-clock'
import { samplePetVisit } from './pet-visit-motion'
import { PetMotifIcon } from './pet-motif-icon'
import './pet-visits.css'

export type PetVisitStageProps = {
  visit: PetVisit; pet: PetOverlayBootstrap; pets: PetSummary[]; width: number; height: number
  primaryOrigin: { x: number; y: number }; mascotWidth: number; language: string
  actorEvents: ButtonHTMLAttributes<HTMLButtonElement>; onDismiss: () => void
}

export function PetVisitStage(props: PetVisitStageProps): ReactElement {
  return props.visit.reason === 'bottle' ? <PetBottleStage {...props} /> : <PetFriendVisitStage {...props} />
}

function PetFriendVisitStage(props: PetVisitStageProps): ReactElement {
  const { visit, pet, pets, language } = props
  const { elapsed, reduced } = usePetAnimationClock(String(visit.id), false)
  const currentTime = Math.max(Date.now(), visit.startedAt + elapsed)
  const primary: PetSummary = { id: pet.petId!, sourceId: pet.petId!.split(':').slice(1).join(':'),
    displayName: pet.displayName ?? '', description: pet.description ?? '', source: 'kun-local',
    available: true, sourceMissing: false, spriteVersionNumber: pet.spriteVersionNumber,
    spritesheetUrl: pet.spritesheetUrl ?? undefined, interactions: pet.interactions }
  const cast = [primary, ...visit.guestIds.map((id) => pets.find((candidate) => candidate.id === id)).filter((value): value is PetSummary => Boolean(value))]
  const view = samplePetVisit({ ...props, cast, now: currentTime, reduced })
  const text = (pair: [string, string]): string => petEnsembleText(pair, language)
  const title = view.phase === 'departing' ? text(['下次再来玩', 'See you next time'])
    : view.phase === 'arriving' ? text(['叫朋友来玩一会儿', 'A little visit from friends']) : text(PET_SCENES[visit.scene].title)
  return <div className="pet-visit-stage" data-pet-visit={visit.reason} data-visit-phase={view.phase} style={{ width: props.width, height: props.height }}>
    <div className="pet-visit-caption"><span>{title}</span><button type="button" onClick={props.onDismiss}
      aria-label={text(['结束这次来访', 'End this visit'])}><X aria-hidden="true" /></button></div>
    {cast.map((actor, index) => {
      const state = view.actors[index]
      const pose = index === 0 && view.phase === 'arriving' ? actor.interactions?.greeting.states[0] ?? state.pose : state.pose
      const frame = reduced ? staticFrame('idle', actor.spriteVersionNumber)
        : frameAtElapsedMs(pose, elapsed % totalCycleDurationMs(pose), actor.spriteVersionNumber)
      return <button {...props.actorEvents} key={actor.id} type="button" className="pet-sprite pet-visit-actor"
        data-visit-host={index === 0} aria-label={actor.displayName} title={actor.displayName}
        style={{ left: state.x - state.size / 2, top: state.y - state.size * 208 / 384 - state.lift,
          width: state.size, height: state.size * 208 / 192, opacity: state.opacity, zIndex: Math.round(state.y),
          transform: `rotate(${state.tilt}deg) scale(${state.scale})`,
          backgroundImage: `url("${actor.spritesheetUrl}")`, backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(actor.spriteVersionNumber) * 100}%`,
          backgroundPosition: frame.backgroundPosition }} />
    })}
    {view.token ? <span className="pet-visit-token" aria-hidden="true" style={{ left: view.token.x, top: view.token.y }}>
      <PetMotifIcon motif={view.token.motif} />
    </span> : null}
  </div>
}
