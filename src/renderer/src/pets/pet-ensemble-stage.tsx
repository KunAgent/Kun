import type { ButtonHTMLAttributes, ReactElement } from 'react'
import { usePetAnimationClock } from './use-pet-animation-clock'
import { BookOpen, Bug, Circle, Code2, Coffee, Gift, Heart, Leaf, Lightbulb, Moon, Music, Orbit, Sparkles, Star, Wind } from 'lucide-react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetSummary } from '@shared/pets'
import { isBuiltinPetId, isKunPetId } from '@shared/pets-builtin'
import type { PetEnsembleSettings } from '@shared/pets-ensemble'
import type { PetReactionKind } from '@shared/pets-interactions'
import { petReactionLabel, reactionFrame } from './pet-reactions'
import { frameAtElapsedMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { PET_PERSONAS, PET_SCENES, petEnsembleText, type PetMotif } from './pet-ensemble-catalog'
import { ensembleActorRect, ensembleActorSize, samplePetEnsemble } from './pet-ensemble-motion'
import './pet-ensemble.css'

const ICONS = { book: BookOpen, bug: Bug, code: Code2, coffee: Coffee, gift: Gift, heart: Heart,
  leaf: Leaf, idea: Lightbulb, moon: Moon, music: Music, orbit: Orbit, spark: Sparkles,
  star: Star, wind: Wind, bubble: Circle, ball: Circle }

export function PetMotifIcon({ motif }: { motif: PetMotif }): ReactElement {
  const Icon = ICONS[motif]
  return <Icon aria-hidden="true" strokeWidth={1.8} />
}


export function PetEnsembleStage(props: {
  settings: PetEnsembleSettings; pets: PetSummary[]; language: string
  width: number; height: number; mascotWidth?: number
  actorEvents?: ButtonHTMLAttributes<HTMLButtonElement>
  reaction?: { kind: PetReactionKind | 'greeting'; level: number; eventId: number; partnerId?: string }
}): ReactElement {
  const { settings, pets, language, width, height, actorEvents, reaction } = props
  const available = new Map(pets.filter((pet) => pet.source === 'kun-builtin' && pet.available && pet.spritesheetUrl && isBuiltinPetId(pet.sourceId))
    .map((pet) => [pet.sourceId, pet]))
  const members = settings.members.filter((id) => available.has(id))
  if (reaction?.partnerId && isBuiltinPetId(reaction.partnerId) && available.has(reaction.partnerId) && !members.includes(reaction.partnerId)) {
    members.push(reaction.partnerId)
  }
  const key = `${settings.scene}:${settings.autoplay}:${settings.members.join(',')}`
  const { elapsed, reduced } = usePetAnimationClock(key, settings.paused || !settings.enabled || Boolean(reaction))
  const responseClock = usePetAnimationClock(`${reaction?.kind}:${reaction?.eventId}`, !reaction || settings.paused || !settings.enabled)
  const sample = samplePetEnsemble({ ...settings, members }, elapsed, reduced)
  const size = ensembleActorSize(members.length, width, height, props.mascotWidth)
  const scene = PET_SCENES[sample.scene]
  const motif = reaction ? ({ typing: 'code', listening: 'bubble', speaking: 'music', transcribing: 'book', greeting: 'heart' } as const)[reaction.kind] : scene.motif
  const text = (pair: [string, string]): string => petEnsembleText(pair, language)
  const featured = sample.actors.find((actor) => actor.id === reaction?.partnerId) ?? sample.actors.find((actor) => actor.featured)
  const complete = members.some(isKunPetId) && members.some((id) => !isKunPetId(id))
  return (
    <div className="pet-ensemble-stage" data-pet-ensemble-reaction={reaction?.kind} style={{ width, height }} role="group" aria-label={text(['伙伴小剧场', 'Companion theater'])}>
      <div className="pet-ensemble-caption"><PetMotifIcon motif={motif} /><span>{reaction
        ? petReactionLabel(reaction.kind, language, available.get(reaction.partnerId ?? '')?.displayName) : text(scene.title)}</span><small>{members.length}</small></div>
      {!complete ? <p className="pet-ensemble-unavailable" role="status">{text(['请选择至少一个 Kun 和一个可用的 AI 伙伴', 'Choose at least one Kun and one available AI companion'])}</p> : <>
        {['stargazing', 'brainstorm', 'orchestra'].includes(sample.scene) ? <svg className="pet-ensemble-constellation" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {sample.actors.slice(1).map((actor, index) => <line key={actor.id}
            x1={sample.actors[index].x * width} y1={sample.actors[index].y * height}
            x2={actor.x * width} y2={actor.y * height} />)}
        </svg> : null}
        {sample.actors.map((actor, index) => {
          const pet = available.get(actor.id)!
          const persona = PET_PERSONAS[actor.id]
          const response = reaction ? reactionFrame({ pack: pet.interactions,
            kind: reaction.kind === 'greeting' && !isKunPetId(actor.id) && actor.id !== reaction.partnerId ? 'listening' : reaction.kind,
            level: reaction.level, elapsed: responseClock.elapsed, version: pet.spriteVersionNumber, reduced: reduced || settings.paused }) : null
          const frame = response?.frame ?? (reduced ? staticFrame(actor.pose, pet.spriteVersionNumber)
            : frameAtElapsedMs(actor.pose, (sample.elapsed + index * 137) % totalCycleDurationMs(actor.pose), pet.spriteVersionNumber))
          return <div key={actor.id} className="pet-ensemble-actor" data-featured={actor.id === featured?.id}
            style={{ ...ensembleActorRect(response ? { ...actor, lift: response.lift } : actor, size, width, height), zIndex: Math.round(actor.y * 100), color: persona.color }}>
            <button {...actorEvents} type="button" className="pet-sprite pet-ensemble-sprite"
              aria-label={`${pet.displayName} · ${text(persona.role)}`} title={`${pet.displayName} · ${text(persona.role)}`}
              style={{ width: size, height: size * 208 / 192, transform: response
                ? `rotate(${response.tilt}deg) scaleY(${response.scaleY})` : `rotate(${actor.tilt}deg) scale(${actor.scale})`,
                backgroundImage: `url("${pet.spritesheetUrl}")`,
                backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(pet.spriteVersionNumber) * 100}%`,
                backgroundPosition: frame.backgroundPosition }} />
            <span className="pet-ensemble-signature"><PetMotifIcon motif={persona.motif} /></span>
          </div>
        })}
        {!reaction && sample.token.visible ? <span className="pet-ensemble-token" style={{ left: sample.token.x * width, top: Math.max(42, sample.token.y * height) }}>
          <PetMotifIcon motif={sample.token.motif} />
        </span> : null}
        {featured ? <span className="pet-ensemble-current" style={{ color: PET_PERSONAS[featured.id].color }}>
          {available.get(featured.id)?.displayName} · {text(PET_PERSONAS[featured.id].role)}
        </span> : null}
        <span className="pet-ensemble-progress" aria-hidden="true" style={{ transform: `scaleX(${reduced ? 0 : sample.progress})` }} />
      </>}
    </div>
  )
}
