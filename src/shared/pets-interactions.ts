import { PET_ROWS, type PetAnimationState } from './pets'
import { PET_SCENE_IDS, type PetSceneId } from './pets-ensemble'
import type { PetBottleRecipe } from './pets-bottle'

export const PET_REACTION_KINDS = ['typing', 'listening', 'speaking', 'transcribing'] as const
export type PetReactionKind = typeof PET_REACTION_KINDS[number]
export type PetReactionClip = { state: PetAnimationState; tempo: number; strength: number }
export type PetInteractionPack = {
  version: 1
  modelAliases: string[]
  providerAliases: string[]
  greeting: { states: PetAnimationState[]; durationMs: number }
  clips: Record<PetReactionKind, PetReactionClip>
  visits?: { scenes: PetSceneId[]; arrival: 'walk' | 'hop' | 'peek' }
  bottle?: PetBottleRecipe
}

export function defaultPetInteractions(): PetInteractionPack {
  return { version: 1, modelAliases: [], providerAliases: [],
    greeting: { states: ['waving', 'jumping', 'waving'], durationMs: 4800 },
    clips: {
      typing: { state: 'running', tempo: 1.2, strength: .6 },
      listening: { state: 'waiting', tempo: .7, strength: .4 },
      speaking: { state: 'waving', tempo: 1, strength: .6 },
      transcribing: { state: 'review', tempo: .75, strength: .3 }
    } }
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
const pose = (value: unknown): value is PetAnimationState => typeof value === 'string' && Object.hasOwn(PET_ROWS, value)

/** Declarative sprite recipes only: no executable files, URLs, or regular expressions. */
export function parsePetInteractionPack(value: unknown): PetInteractionPack | null {
  if (!record(value) || value.version !== 1 || !record(value.clips) || !record(value.greeting)) return null
  const aliases = (list: unknown): list is string[] => Array.isArray(list) && list.length <= 16 &&
    list.every((word) => typeof word === 'string' && /^[a-z0-9][a-z0-9._-]{0,47}$/.test(word)) && new Set(list).size === list.length
  if (!aliases(value.modelAliases) || !aliases(value.providerAliases)) return null
  if (!Array.isArray(value.greeting.states) || value.greeting.states.length < 1 || value.greeting.states.length > 6 ||
    !value.greeting.states.every(pose) || !finite(value.greeting.durationMs, 1000, 10000)) return null
  const clips = {} as PetInteractionPack['clips']
  for (const kind of PET_REACTION_KINDS) {
    const clip = value.clips[kind]
    if (!record(clip) || !pose(clip.state) || !finite(clip.tempo, .25, 3) || !finite(clip.strength, 0, 1)) return null
    clips[kind] = { state: clip.state, tempo: clip.tempo, strength: clip.strength }
  }
  let visits: PetInteractionPack['visits']
  if (value.visits !== undefined) {
    const input = value.visits
    if (!record(input) || !Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 8 ||
      !input.scenes.every((id) => (PET_SCENE_IDS as readonly unknown[]).includes(id)) ||
      new Set(input.scenes).size !== input.scenes.length || !(['walk', 'hop', 'peek'] as readonly unknown[]).includes(input.arrival)) return null
    visits = { scenes: [...input.scenes] as PetSceneId[], arrival: input.arrival as NonNullable<PetInteractionPack['visits']>['arrival'] }
  }
  let bottle: PetBottleRecipe | undefined
  if (value.bottle !== undefined) {
    const input = value.bottle
    if (!record(input) || !(['careful', 'bounce'] as readonly unknown[]).includes(input.catchStyle) ||
      !pose(input.inspectState) || !pose(input.celebrateState) || !finite(input.durationMs, 6000, 12000)) return null
    bottle = { catchStyle: input.catchStyle as PetBottleRecipe['catchStyle'], inspectState: input.inspectState,
      celebrateState: input.celebrateState, durationMs: input.durationMs }
  }
  return { version: 1, modelAliases: [...value.modelAliases], providerAliases: [...value.providerAliases],
    greeting: { states: [...value.greeting.states], durationMs: value.greeting.durationMs }, clips,
    ...(visits ? { visits } : {}), ...(bottle ? { bottle } : {}) }
}

export const PET_PRESENCE_TTL_MS = 1800
export type PetModelPresence = { model: string; provider: string }
export type PetPresenceSignal =
  | { type: 'model'; model: string; provider: string; announce: boolean }
  | { type: 'input'; source: string; kind: PetReactionKind | 'idle'; level: number }
export type PetPresenceSnapshot = {
  revision: number
  model: PetModelPresence | null
  modelChangedAt: number
  input: { kind: PetReactionKind; level: number; expiresAt: number } | null
}

export function emptyPetPresence(): PetPresenceSnapshot {
  return { revision: 0, model: null, modelChangedAt: 0, input: null }
}

export function parsePetPresenceSignal(value: unknown): PetPresenceSignal | null {
  if (!record(value)) return null
  if (value.type === 'model') {
    if (typeof value.model !== 'string' || value.model.length > 200 || typeof value.provider !== 'string' ||
      value.provider.length > 100 || typeof value.announce !== 'boolean') return null
    return { type: 'model', model: value.model.trim(), provider: value.provider.trim(), announce: value.announce }
  }
  if (value.type !== 'input' || typeof value.source !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(value.source)) return null
  if (value.kind !== 'idle' && !(PET_REACTION_KINDS as readonly unknown[]).includes(value.kind)) return null
  if (!finite(value.level, 0, 1)) return null
  return { type: 'input', source: value.source, kind: value.kind as PetReactionKind | 'idle', level: value.level }
}
