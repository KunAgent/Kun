import type { PetTypingState } from '@shared/pets-typing'
import type { Point } from './joint/geometry'
import { PetTypingStage } from './typing/typing-stage'
import { useRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { Keyboard, Mic, AudioLines, MessageCircle } from 'lucide-react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetOverlayBootstrap } from '@shared/pets'
import type { PetReactionKind } from '@shared/pets-interactions'
import { petReactionLabel, reactionFrame } from './pet-reactions'
import { paintPetStyle, usePetAnimationPainter } from './use-pet-animation-painter'
import './pet-reactions.css'

type ReactionStageProps = {
  pet: PetOverlayBootstrap; kind: PetReactionKind; level: number
  width: number; height: number; mascotWidth: number; paused: boolean; language: string; eventId: number
  actorEvents: ButtonHTMLAttributes<HTMLButtonElement>
  typing?: PetTypingState; expiresAt: number; primaryOrigin: Point
}

export function PetReactionStage(props: ReactionStageProps): ReactElement {
  return props.kind === 'typing' && props.pet.interactions?.joint ? <PetTypingStage key={props.pet.petId} {...props} origin={props.primaryOrigin} />
    : <PetSpriteReactionStage {...props} />
}

function PetSpriteReactionStage(props: ReactionStageProps): ReactElement {
  const { pet, kind, level, width, height, paused } = props
  const actor = useRef<HTMLButtonElement>(null)
  const bars = useRef<Array<HTMLElement | null>>([])
  const size = Math.min(props.mascotWidth, width - 24)
  usePetAnimationPainter(`${kind}:${pet.petId}:${props.eventId}`, paused, ({ elapsed, reduced }) => {
    const frame = reactionFrame({ pack: pet.interactions, kind, level, elapsed,
      version: pet.spriteVersionNumber, reduced: reduced || paused })
    paintPetStyle(actor.current, {
      transform: `translate3d(0, ${-frame.lift}px, 0) rotate(${frame.tilt}deg) scaleY(${frame.scaleY})`,
      backgroundPosition: frame.frame.backgroundPosition
    })
    for (let i = 0; i < bars.current.length; i++) {
      const height = reduced || paused ? 4 : 3 + level * (7 + Math.abs(Math.sin(elapsed / 100 + i)) * 13)
      paintPetStyle(bars.current[i], { transform: `scaleY(${height / 23})` })
    }
  })
  const caption = petReactionLabel(kind, props.language, pet.displayName)
  const Icon = { typing: Keyboard, listening: Mic, speaking: AudioLines, transcribing: MessageCircle }[kind]
  return <div className="pet-reaction-stage" data-pet-reaction={kind} style={{ width, height }} role="group" aria-label={caption}>
    <div className="pet-reaction-caption"><Icon aria-hidden="true" /><span>{caption}</span></div>
    <button {...props.actorEvents} ref={actor} type="button" className="pet-sprite pet-reaction-actor"
      aria-label={pet.displayName ?? 'Desktop pet'} title={pet.displayName ?? undefined}
      style={{ position: 'absolute', left: (width - size) / 2,
        top: 34 + (height - 64 - size * 208 / 192) / 2, width: size, height: size * 208 / 192,
        transformOrigin: 'center bottom', willChange: 'transform',
        backgroundImage: pet.spritesheetUrl ? `url("${pet.spritesheetUrl}")` : undefined,
        backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(pet.spriteVersionNumber) * 100}%` }} />
    {kind === 'listening' || kind === 'speaking' ? <span className="pet-reaction-wave" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => <i key={i} ref={(node) => { bars.current[i] = node }} />)}
    </span> : <span className="pet-reaction-caption-bottom">{pet.displayName}</span>}
  </div>
}
