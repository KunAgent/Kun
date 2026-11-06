import type { ReactElement } from 'react'
import { Sparkles, X } from 'lucide-react'
import bottleUrl from '../../../asset/img/kun-avatar/256/container/bottle-sealed.webp?url'
import { defaultPetBottleRecipe } from '@shared/pets-bottle'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion } from '@shared/pets'
import { frameAtElapsedMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { usePetAnimationClock } from './use-pet-animation-clock'
import { petEnsembleText } from './pet-ensemble-catalog'
import type { PetVisitStageProps } from './pet-visit-stage'
import { samplePetBottle } from './pet-bottle-motion'
import './pet-bottle.css'

export function PetBottleStage(props: PetVisitStageProps): ReactElement {
  const { pet, visit } = props
  const { elapsed, reduced } = usePetAnimationClock(`bottle:${visit.id}`, false)
  const now = Math.max(Date.now(), visit.startedAt + elapsed)
  const recipe = pet.interactions?.bottle ?? defaultPetBottleRecipe()
  const view = samplePetBottle({ ...props, recipe, now, reduced })
  const frame = reduced ? staticFrame(view.actor.pose, pet.spriteVersionNumber)
    : frameAtElapsedMs(view.actor.pose, elapsed % totalCycleDurationMs(view.actor.pose), pet.spriteVersionNumber)
  const text = (pair: [string, string]): string => petEnsembleText(pair, props.language)
  const captions = {
    falling: ['咦，有漂流瓶！', 'A bottle washed up!'], approaching: ['过去看看', 'Let’s take a look'],
    catching: ['接住啦', 'Got it!'], inspecting: ['轻轻看一看', 'A curious little look'],
    celebrating: ['新瓶子送到了', 'A new bottle arrived'], settling: ['在瓶架里等你', 'Waiting on your bottle shelf']
  } as const
  const count = visit.bottleCount ?? 1
  const actor = view.actor, bottle = view.bottle
  return <div className="pet-bottle-stage" data-pet-bottle={view.phase} data-bottle-style={recipe.catchStyle}
    style={{ width: props.width, height: props.height }} role="group" aria-label={text(['漂流瓶掉落', 'New bottle drop'])}>
    <div className="pet-visit-caption pet-bottle-caption" data-below={view.captionBelow}>
      <span>{text([...captions[view.phase]])}{count > 1 ? ` ×${count}` : ''}</span>
      <button type="button" onClick={props.onDismiss} aria-label={text(['收起掉落动画', 'Dismiss bottle animation'])}><X aria-hidden="true" /></button>
    </div>
    <span className="pet-bottle-shadow" aria-hidden="true" style={{ left: bottle.x, top: view.groundY, opacity: bottle.opacity * .18 }} />
    <button {...props.actorEvents} type="button" className="pet-sprite pet-bottle-actor" aria-label={pet.displayName ?? 'Desktop pet'}
      style={{ left: actor.x - actor.size / 2, top: actor.y - actor.size * 208 / 384, width: actor.size, height: actor.size * 208 / 192,
        transform: `rotate(${actor.tilt}deg)`, backgroundImage: `url("${pet.spritesheetUrl}")`,
        backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(pet.spriteVersionNumber) * 100}%`, backgroundPosition: frame.backgroundPosition }} />
    <img className="pet-bottle-prop" src={bottleUrl} alt="" aria-hidden="true" draggable={false}
      style={{ left: bottle.x - bottle.size / 2, top: bottle.y - bottle.size / 2, width: bottle.size, height: bottle.size,
        transform: `rotate(${bottle.angle}deg) scale(${bottle.scale})`, opacity: bottle.opacity }} />
    {!reduced && view.spark > 0 ? <span className="pet-bottle-spark" aria-hidden="true"
      style={{ left: actor.x + actor.size * .35, top: actor.y - actor.size * .5, opacity: view.spark }}><Sparkles /></span> : null}
  </div>
}
