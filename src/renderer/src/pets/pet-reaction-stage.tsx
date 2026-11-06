import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { Keyboard, Mic, AudioLines, MessageCircle } from 'lucide-react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetOverlayBootstrap } from '@shared/pets'
import type { PetReactionKind } from '@shared/pets-interactions'
import { petReactionLabel, reactionFrame } from './pet-reactions'
import { usePetAnimationClock } from './use-pet-animation-clock'
import './pet-reactions.css'

export function PetReactionStage(props: {
  pet: PetOverlayBootstrap; kind: PetReactionKind; level: number
  width: number; height: number; mascotWidth: number; paused: boolean; language: string; eventId: number
  actorEvents: ButtonHTMLAttributes<HTMLButtonElement>
}): ReactElement {
  const { pet, kind, level, width, height, paused } = props
  const key = `${kind}:${pet.petId}:${props.eventId}`
  const { elapsed, reduced } = usePetAnimationClock(key, paused)
  const caption = petReactionLabel(kind, props.language, pet.displayName)
  const Icon = { typing: Keyboard, listening: Mic, speaking: AudioLines, transcribing: MessageCircle }[kind]
  const actors = [{ id: pet.petId, displayName: pet.displayName, spritesheetUrl: pet.spritesheetUrl,
    spriteVersionNumber: pet.spriteVersionNumber, interactions: pet.interactions }]
  const size = Math.min(props.mascotWidth, (width - 24) / actors.length)
  return <div className="pet-reaction-stage" data-pet-reaction={kind} style={{ width, height }} role="group" aria-label={caption}>
    <div className="pet-reaction-caption"><Icon aria-hidden="true" /><span>{caption}</span></div>
    {actors.map((actor, index) => {
      const frame = reactionFrame({ pack: actor.interactions, kind, level, elapsed,
        version: actor.spriteVersionNumber, reduced: reduced || paused })
      return <button {...props.actorEvents} key={actor.id} type="button" className="pet-sprite pet-reaction-actor"
        aria-label={actor.displayName ?? 'Desktop pet'} title={actor.displayName ?? undefined}
        style={{ position: 'absolute', left: (width * (index + .5) / actors.length) - size / 2,
          top: 34 + (height - 64 - size * 208 / 192) / 2 - frame.lift, width: size, height: size * 208 / 192,
          transform: `rotate(${frame.tilt}deg) scaleY(${frame.scaleY})`, transformOrigin: 'center bottom',
          backgroundImage: actor.spritesheetUrl ? `url("${actor.spritesheetUrl}")` : undefined,
          backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(actor.spriteVersionNumber) * 100}%`,
          backgroundPosition: frame.frame.backgroundPosition }} />
    })}
    {kind === 'listening' || kind === 'speaking' ? <span className="pet-reaction-wave" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => <i key={i} style={{ height: reduced || paused ? 4 : 3 + level * (7 + Math.abs(Math.sin(elapsed / 100 + i)) * 13) }} />)}
    </span> : <span className="pet-reaction-caption-bottom">{pet.displayName}</span>}
  </div>
}
