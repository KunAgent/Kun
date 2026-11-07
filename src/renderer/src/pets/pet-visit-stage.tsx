import { PetBottleStage } from './pet-bottle-stage'
import { useRef, useState, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { PET_ROWS, PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetOverlayBootstrap, type PetSummary } from '@shared/pets'
import type { PetVisit } from '@shared/pets-visits'
import { frameAtElapsedMs, framePosition, staticFrame, totalCycleDurationMs } from './pet-animation'
import { petEnsembleText } from './pet-ensemble-catalog'
import { paintPetStyle, usePetAnimationPainter } from './use-pet-animation-painter'
import { samplePetVisit } from './pet-visit-motion'
import { PetStoryProp } from './pet-story-prop'
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
  const shadows = useRef<Array<HTMLSpanElement | null>>([])
  const objects = useRef<Record<string, SVGSVGElement | null>>({})
  const [phase, setPhase] = useState(() => samplePetVisit({ ...props, cast, now: Date.now(), reduced: true }).phase)
  const [storyBeat, setStoryBeat] = useState<[string, string]>(['', ''])
  const paintedPhase = useRef(phase)
  const paintedBeat = useRef('')
  const view = samplePetVisit({ ...props, cast, now: Date.now(), reduced: true })
  usePetAnimationPainter(String(visit.id), false, ({ reduced }) => {
    const motion = samplePetVisit({ ...props, cast, now: Date.now(), reduced })
    if (paintedBeat.current !== motion.beat[0]) { paintedBeat.current = motion.beat[0]; setStoryBeat(motion.beat) }
    if (paintedPhase.current !== motion.phase) { paintedPhase.current = motion.phase; setPhase(motion.phase) }
    const depth = motion.actors.map((state, index) => ({ y: state.y + state.size * state.scale * .45, index })).sort((a, b) => a.y - b.y)
    motion.actors.forEach((state, index) => {
      const actor = cast[index]
      const pose = index === 0 && motion.phase === 'arriving' ? actor.interactions?.greeting.states[0] ?? state.pose : state.pose
      const frame = reduced ? staticFrame('idle', actor.spriteVersionNumber)
        : frameAtElapsedMs(pose, state.poseTime % totalCycleDurationMs(pose), actor.spriteVersionNumber)
      const direction = pose.startsWith('running-') ? 1 : state.facing * (pose === 'waving' && actor.sourceId !== 'ikun' ? -1 : 1)
      const position = state.frame === undefined || reduced ? frame.backgroundPosition
        : framePosition(PET_ROWS[pose].row, state.frame, petSheetRowsForVersion(actor.spriteVersionNumber))
      paintPetStyle(shadows.current[index], { opacity: String(state.opacity * .10 * (1 - Math.min(.5, state.lift / 50))),
        width: `${state.size * state.scale * .57}px`,
        transform: `translate3d(${state.x}px, ${state.y + state.size * state.scale * .43}px, 0) translateX(-50%)` })
      paintPetStyle(actors.current[index], {
        width: `${state.size}px`, height: `${state.size * 208 / 192}px`,
        transform: `translate3d(${state.x - state.size / 2}px, ${state.y - state.size * 208 / 384 - state.lift}px, 0) rotate(${state.tilt}deg) scale(${state.scale * direction}, ${state.scale})`,
        opacity: String(state.opacity), zIndex: String(1 + depth.findIndex((item) => item.index === index)),
        backgroundPosition: position
      })
    })
    for (const item of motion.props) {
      const element = objects.current[item.id]
      paintPetStyle(element, { width: `${item.size}px`, height: `${item.size}px`, opacity: String(item.opacity),
        zIndex: item.behind ? '0' : '200',
        transform: `translate3d(${item.x - item.size / 2}px, ${item.y - item.size / 2}px, 0) rotate(${item.rotation}deg) scale(${item.scale})` })
      if (element && element.style.getPropertyValue('--pet-prop-detail') !== String(item.detail)) {
        element.style.setProperty('--pet-prop-detail', String(item.detail))
      }
    }
  })
  const text = (pair: [string, string]): string => petEnsembleText(pair, language)
  const title = phase === 'departing' ? text(['下次再来玩', 'See you next time'])
    : phase === 'arriving' ? text(['叫朋友来玩一会儿', 'A little visit from friends']) : text(storyBeat)
  return <div className="pet-visit-stage" data-pet-visit={visit.reason} data-visit-phase={phase} style={{ width: props.width, height: props.height }}>
    <div className="pet-visit-caption"><span>{title}</span><button type="button" onClick={props.onDismiss}
      aria-label={text(['结束这次来访', 'End this visit'])}><X aria-hidden="true" /></button></div>
    {cast.map((actor, index) => <span key={actor.id} className="pet-visit-shadow" aria-hidden="true"
      ref={(node) => { shadows.current[index] = node }} />)}
    {cast.map((actor, index) => {
      return <button {...props.actorEvents} key={actor.id} ref={(node) => { actors.current[index] = node }} type="button" className="pet-sprite pet-visit-actor"
        data-visit-host={index === 0} aria-label={actor.displayName} title={actor.displayName}
        style={{ left: 0, top: 0, willChange: 'transform, opacity',
          backgroundImage: `url("${actor.spritesheetUrl}")`, backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(actor.spriteVersionNumber) * 100}%` }} />
    })}
    {view.props.map((item) => <PetStoryProp key={item.id} kind={item.kind}
      elementRef={(node) => { objects.current[item.id] = node }} />)}
  </div>
}
