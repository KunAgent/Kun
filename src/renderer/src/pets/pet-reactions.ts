import type { PetSummary } from '@shared/pets'
import { defaultPetInteractions, type PetInteractionPack, type PetModelPresence, type PetPresenceSnapshot, type PetReactionKind } from '@shared/pets-interactions'
import { frameAtElapsedMs, staticFrame, totalCycleDurationMs } from './pet-animation'

export function petReactionLabel(kind: PetReactionKind | 'greeting', language: string, partner?: string | null): string {
  const zh = language.toLowerCase().startsWith('zh')
  return {
    typing: zh ? '陪你一起输入' : 'Typing with you', listening: zh ? '正在倾听' : 'Listening',
    speaking: zh ? '正在说话' : 'Speaking', transcribing: zh ? '正在整理语音' : 'Transcribing',
    greeting: zh ? `${partner ?? '伙伴'} 来啦` : `Hello, ${partner ?? 'companion'}`
  }[kind]
}

function aliasScore(model: string, alias: string): number {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[/\\s:_.-])${escaped}(?=$|[/\\s:_.-]|[0-9])`, 'i').test(model) ? alias.length : 0
}

export function petForModel(selection: PetModelPresence | null, pets: PetSummary[]): PetSummary | null {
  if (!selection) return null
  const candidates = pets.filter((pet) => pet.source === 'kun-builtin' && pet.available && pet.spritesheetUrl && pet.interactions)
  let best: PetSummary | null = null
  let score = 0
  for (const pet of candidates) {
    const match = Math.max(0, ...pet.interactions!.modelAliases.map((alias) => aliasScore(selection.model, alias)))
    if (match > score) { best = pet; score = match }
  }
  if (best) return best
  // Do not turn an unknown model on an OpenAI-compatible gateway into GPT.
  if (selection.model && !/^(auto|default|native)$/i.test(selection.model)) return null
  return candidates.find((pet) => pet.interactions!.providerAliases.includes(selection.provider.toLowerCase())) ?? null
}

export function currentPetReaction(snapshot: PetPresenceSnapshot, now: number): { kind: PetReactionKind; level: number } | null {
  const input = snapshot.input
  return input && input.expiresAt > now ? { kind: input.kind, level: input.level } : null
}

export function reactionFrame(input: {
  pack?: PetInteractionPack; kind: PetReactionKind | 'greeting'; level: number; elapsed: number
  version: 1 | 2; reduced: boolean
}) {
  const pack = input.pack ?? defaultPetInteractions()
  const speaking = input.kind === 'speaking' || (input.kind === 'listening' && input.level > .05)
  const kind = speaking ? 'speaking' : input.kind
  const greeting = kind === 'greeting'
  const phase = greeting ? Math.min(pack.greeting.states.length - 1,
    Math.floor(input.elapsed / pack.greeting.durationMs * pack.greeting.states.length)) : 0
  const clip = greeting ? { state: pack.greeting.states[phase], tempo: 1, strength: .5 } : pack.clips[kind]
  const activeVoice = speaking ? input.level : 1
  const clock = input.elapsed * clip.tempo
  // Speech pauses must look quiet even when the audio player is buffering silence.
  const still = input.reduced || (input.kind === 'speaking' && activeVoice <= .05)
  const frame = still ? staticFrame(speaking ? 'waiting' : clip.state, input.version)
    : frameAtElapsedMs(clip.state, clock % totalCycleDurationMs(clip.state), input.version)
  const wave = still ? 0 : Math.sin(clock / (kind === 'typing' ? 70 : 150))
  return { frame, tilt: wave * clip.strength * (speaking ? 6 * activeVoice : 2),
    lift: still ? 0 : Math.abs(wave) * clip.strength * (speaking ? 5 * activeVoice : kind === 'typing' ? 2 : 1),
    scaleY: 1 + (still ? 0 : wave * clip.strength * (speaking ? .035 * activeVoice : .008)) }
}
