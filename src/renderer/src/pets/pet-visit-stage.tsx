import { PetBottleStage } from './pet-bottle-stage'
import { useRef, useState, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetOverlayBootstrap, type PetSummary } from '@shared/pets'
import type { PetVisit } from '@shared/pets-visits'
import { frameAtElapsedMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { petEnsembleText, PET_SCENES } from './pet-ensemble-catalog'
import { paintPetStyle, usePetAnimationPainter } from './use-pet-animation-painter'
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
  const primary: PetSummary = { id: pet.petId!, sourceId: pet.petId!.split(':').slice(1).join(':'),
    displayName: pet.displayName ?? '', description: pet.description ?? '', source: 'kun-local',
    available: true, sourceMissing: false, spriteVersionNumber: pet.spriteVersionNumber,
    spritesheetUrl: pet.spritesheetUrl ?? undefined, interactions: pet.interactions }
  const cast = [primary, ...visit.guestIds.map((id) => pets.find((candidate) => candidate.id === id)).filter((value): value is PetSummary => Boolean(value))]
  const actors = useRef<Array<HTMLButtonElement | null>>([])
  const token = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState(() => samplePetVisit({ ...props, cast, now: Date.now(), reduced: true }).phase)
  const paintedPhase = useRef(phase)
  usePetAnimationPainter(String(visit.id), false, ({ elapsed, reduced }) => {
    const motion = samplePetVisit({ ...props, cast, now: Date.now(), reduced })
    if (paintedPhase.current !== motion.phase) { paintedPhase.current = motion.phase; setPhase(motion.phase) }
    const depth = motion.actors.map((state, index) => ({ y: state.y, index })).sort((a, b) => a.y - b.y)
    motion.actors.forEach((state, index) => {
      const actor = cast[index]
      const pose = index === 0 && motion.phase === 'arriving' ? actor.interactions?.greeting.states[0] ?? state.pose : state.pose
      const frame = reduced ? staticFrame('idle', actor.spriteVersionNumber)
        : frameAtElapsedMs(pose, elapsed % totalCycleDurationMs(pose), actor.spriteVersionNumber)
      paintPetStyle(actors.current[index], {
        width: `${state.size}px`, height: `${state.size * 208 / 192}px`,
        transform: `translate3d(${state.x - state.size / 2}px, ${state.y - state.size * 208 / 384 - state.lift}px, 0) rotate(${state.tilt}deg) scale(${state.scale})`,
        opacity: String(state.opacity), zIndex: String(1 + depth.findIndex((item) => item.index === index)),
        backgroundPosition: frame.backgroundPosition
      })
    })
    paintPetStyle(token.current, { opacity: motion.token ? '1' : '0',
      transform: motion.token ? `translate3d(${motion.token.x}px, ${motion.token.y}px, 0) translate(-50%, -50%)` : '' })
  })
  const text = (pair: [string, string]): string => petEnsembleText(pair, language)
  const title = phase === 'departing' ? text(['下次再来玩', 'See you next time'])
    : phase === 'arriving' ? text(['叫朋友来玩一会儿', 'A little visit from friends']) : text(PET_SCENES[visit.scene].title)
  return <div className="pet-visit-stage" data-pet-visit={visit.reason} data-visit-phase={phase} style={{ width: props.width, height: props.height }}>
    <div className="pet-visit-caption"><span>{title}</span><button type="button" onClick={props.onDismiss}
      aria-label={text(['结束这次来访', 'End this visit'])}><X aria-hidden="true" /></button></div>
    {cast.map((actor, index) => {
      return <button {...props.actorEvents} key={actor.id} ref={(node) => { actors.current[index] = node }} type="button" className="pet-sprite pet-visit-actor"
        data-visit-host={index === 0} aria-label={actor.displayName} title={actor.displayName}
        style={{ left: 0, top: 0, willChange: 'transform, opacity',
          backgroundImage: `url("${actor.spritesheetUrl}")`, backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(actor.spriteVersionNumber) * 100}%` }} />
    })}
    <span ref={token} className="pet-visit-token" aria-hidden="true" style={{ left: 0, top: 0, willChange: 'transform' }}>
      <PetMotifIcon motif={PET_SCENES[visit.scene].motif} />
    </span>
  </div>
}
