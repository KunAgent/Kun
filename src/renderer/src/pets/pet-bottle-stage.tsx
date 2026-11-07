import { useRef, useState, type ReactElement } from 'react'
import { Sparkles, X } from 'lucide-react'
import bottleUrl from '../../../asset/img/kun-avatar/256/container/bottle-sealed.webp?url'
import { defaultPetBottleRecipe } from '@shared/pets-bottle'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion } from '@shared/pets'
import { frameAtElapsedMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { paintPetStyle, usePetAnimationPainter } from './use-pet-animation-painter'
import { petEnsembleText } from './pet-ensemble-catalog'
import type { PetVisitStageProps } from './pet-visit-stage'
import { samplePetBottle } from './pet-bottle-motion'
import './pet-bottle.css'

export function PetBottleStage(props: PetVisitStageProps): ReactElement {
  const { pet, visit } = props
  const recipe = pet.interactions?.bottle ?? defaultPetBottleRecipe()
  const actorRef = useRef<HTMLButtonElement>(null)
  const bottleRef = useRef<HTMLImageElement>(null)
  const shadowRef = useRef<HTMLSpanElement>(null)
  const sparkRef = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState(() => samplePetBottle({ ...props, recipe, now: Date.now(), reduced: true }).phase)
  const paintedPhase = useRef(phase)
  const view = samplePetBottle({ ...props, recipe, now: Date.now(), reduced: true })
  usePetAnimationPainter(`bottle:${visit.id}`, false, ({ elapsed, reduced }) => {
    const motion = samplePetBottle({ ...props, recipe, now: Date.now(), reduced })
    if (paintedPhase.current !== motion.phase) { paintedPhase.current = motion.phase; setPhase(motion.phase) }
    const { actor, bottle } = motion
    const frame = reduced ? staticFrame(actor.pose, pet.spriteVersionNumber)
      : frameAtElapsedMs(actor.pose, elapsed % totalCycleDurationMs(actor.pose), pet.spriteVersionNumber)
    paintPetStyle(actorRef.current, { width: `${actor.size}px`, height: `${actor.size * 208 / 192}px`,
      transform: `translate3d(${actor.x - actor.size / 2}px, ${actor.y - actor.size * 208 / 384}px, 0) rotate(${actor.tilt}deg)`,
      backgroundPosition: frame.backgroundPosition })
    paintPetStyle(bottleRef.current, { width: `${bottle.size}px`, height: `${bottle.size}px`,
      transform: `translate3d(${bottle.x - bottle.size / 2}px, ${bottle.y - bottle.size / 2}px, 0) rotate(${bottle.angle}deg) scale(${bottle.scale})`,
      opacity: String(bottle.opacity) })
    paintPetStyle(shadowRef.current, { transform: `translate3d(${bottle.x}px, ${motion.groundY}px, 0) translateX(-50%)`, opacity: String(bottle.opacity * .18) })
    paintPetStyle(sparkRef.current, { transform: `translate3d(${actor.x + actor.size * .35}px, ${actor.y - actor.size * .5}px, 0)`, opacity: String(reduced ? 0 : motion.spark) })
  })
  const text = (pair: [string, string]): string => petEnsembleText(pair, props.language)
  const captions = {
    falling: ['咦，有漂流瓶！', 'A bottle washed up!'], approaching: ['过去看看', 'Let’s take a look'],
    catching: ['接住啦', 'Got it!'], inspecting: ['轻轻看一看', 'A curious little look'],
    celebrating: ['新瓶子送到了', 'A new bottle arrived'], settling: ['在瓶架里等你', 'Waiting on your bottle shelf']
  } as const
  const count = visit.bottleCount ?? 1
  return <div className="pet-bottle-stage" data-pet-bottle={phase} data-bottle-style={recipe.catchStyle}
    style={{ width: props.width, height: props.height }} role="group" aria-label={text(['漂流瓶掉落', 'New bottle drop'])}>
    <div className="pet-visit-caption pet-bottle-caption" data-below={view.captionBelow}>
      <span>{text([...captions[phase]])}{count > 1 ? ` ×${count}` : ''}</span>
      <button type="button" onClick={props.onDismiss} aria-label={text(['收起掉落动画', 'Dismiss bottle animation'])}><X aria-hidden="true" /></button>
    </div>
    <span ref={shadowRef} className="pet-bottle-shadow" aria-hidden="true" style={{ left: 0, top: 0 }} />
    <button {...props.actorEvents} ref={actorRef} type="button" className="pet-sprite pet-bottle-actor" aria-label={pet.displayName ?? 'Desktop pet'}
      style={{ left: 0, top: 0, willChange: 'transform', backgroundImage: `url("${pet.spritesheetUrl}")`,
        backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(pet.spriteVersionNumber) * 100}%` }} />
    <img ref={bottleRef} className="pet-bottle-prop" src={bottleUrl} alt="" aria-hidden="true" draggable={false}
      style={{ left: 0, top: 0, willChange: 'transform, opacity' }} />
    <span ref={sparkRef} className="pet-bottle-spark" aria-hidden="true" style={{ left: 0, top: 0 }}><Sparkles /></span>
  </div>
}
