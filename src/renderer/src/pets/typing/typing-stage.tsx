import { useRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import type { PetOverlayBootstrap, PetSummary } from '@shared/pets'
import type { PetTypingState } from '@shared/pets-typing'
import type { Point } from '../joint/geometry'
import { usePetCanvas } from '../joint/use-pet-canvas'
import { jointHitPath } from '../joint/timeline'
import { usePetAnimationPainter } from '../use-pet-animation-painter'
import { nextFrameDelayMs } from '../pet-animation'
import { PetResidentSprite } from '../pet-resident-sprite'
import { PetTypingMotion } from './typing-motion'
import { petTypingRig } from './typing-rig'
import { typingScene } from './typing-scene'
import '../joint/joint-stage.css'

export function PetTypingStage(props: {
  pet: PetOverlayBootstrap; typing?: PetTypingState; expiresAt: number
  width: number; height: number; mascotWidth: number; origin: Point; paused: boolean; language: string
  actorEvents: ButtonHTMLAttributes<HTMLButtonElement>
}): ReactElement {
  const motion = useRef(new PetTypingMotion()), hit = useRef<HTMLButtonElement>(null)
  const enteredAt = useRef(Date.now())
  const pet: PetSummary = { id: props.pet.petId!, sourceId: props.pet.petId!.split(':').slice(1).join(':'),
    displayName: props.pet.displayName ?? '', description: '', source: 'kun-local', available: true, sourceMissing: false,
    spriteVersionNumber: props.pet.spriteVersionNumber, spritesheetUrl: props.pet.spritesheetUrl ?? undefined,
    interactions: props.pet.interactions }
  const frameAt = (now: number, reduced: boolean) => {
    const state = motion.current.sample(props.typing, now, reduced, props.paused)
    return { state, frame: typingScene({ ...props, pet, now, enteredAt: enteredAt.current, motion: state }) }
  }
  const { canvas, renderer, ready, error, revision } = usePetCanvas(`${pet.id}:${pet.spritesheetUrl}:${JSON.stringify(petTypingRig(pet))}`, () => frameAt(Date.now(), false).frame)
  usePetAnimationPainter(`typing:${pet.id}:${ready}:${revision}`, props.paused, ({ elapsed, reduced }) => {
    const now = Date.now(), { state, frame } = frameAt(now, reduced)
    if (hit.current) hit.current.style.clipPath = `path('${jointHitPath(frame)}')`
    if (!ready) return 80
    renderer.current?.paint(frame, elapsed, reduced)
    const remaining = props.expiresAt - now
    if (state.moving || now - enteredAt.current < 80 || remaining < 240) return
    return Math.max(1, Math.min(nextFrameDelayMs('idle', elapsed), remaining - 220))
  })
  return <div className="pet-reaction-stage pet-typing-stage" data-pet-reaction="typing" data-ready={ready}
    style={{ width: props.width, height: props.height }}>
    <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: props.width, height: props.height,
      visibility: ready ? 'visible' : 'hidden', pointerEvents: 'none' }} aria-hidden="true" />
    {!ready ? <PetResidentSprite animation="idle" version={props.pet.spriteVersionNumber} sheet={props.pet.spritesheetUrl}
      className="pet-sprite" aria-hidden="true" tabIndex={-1}
      style={{ position: 'absolute', pointerEvents: 'none', width: props.mascotWidth, height: props.mascotWidth * 208 / 192,
        left: props.origin.x - props.mascotWidth / 2, top: props.origin.y - props.mascotWidth * 208 / 384 }} /> : null}
    <button {...props.actorEvents} ref={hit} type="button" className="pet-joint-hit"
      aria-label={`${pet.displayName} · ${props.language.startsWith('zh') ? '键盘陪伴' : 'Keyboard companion'}`} />
    {error ? <span className="pet-joint-error" role="status">{props.language.startsWith('zh') ? '角色素材暂时无法显示' : 'Character artwork is unavailable'}</span> : null}
  </div>
}
