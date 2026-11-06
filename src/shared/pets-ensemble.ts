import { BUILTIN_PET_IDS, isBuiltinPetId, isKunPetId, type BuiltinPetId } from './pets-builtin'

export const PET_SCENE_IDS = [
  'welcome', 'high-five', 'wave-relay', 'cheer', 'dance', 'circle-dance',
  'conga', 'chase', 'race', 'hide-and-seek', 'leapfrog', 'exercise',
  'brainstorm', 'coding', 'debug', 'review', 'study', 'orchestra',
  'beatbox', 'gift', 'tea', 'stargazing', 'bubbles', 'finale'
] as const
export type PetSceneId = typeof PET_SCENE_IDS[number]

export type PetEnsembleSettings = {
  enabled: boolean
  members: BuiltinPetId[]
  scene: PetSceneId
  autoplay: boolean
  paused: boolean
}

export function defaultPetEnsemble(): PetEnsembleSettings {
  return {
    enabled: false, members: ['xiao-kun', 'whale-girl', 'gpt-girl', 'claude-girl'],
    scene: 'welcome', autoplay: false, paused: false
  }
}

export function parsePetEnsemble(value: unknown): PetEnsembleSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== 'boolean' || typeof input.autoplay !== 'boolean' || typeof input.paused !== 'boolean') return null
  if (typeof input.scene !== 'string' || !(PET_SCENE_IDS as readonly string[]).includes(input.scene)) return null
  if (!Array.isArray(input.members) || input.members.length < 2 || input.members.length > BUILTIN_PET_IDS.length) return null
  if (!input.members.every(isBuiltinPetId) || new Set(input.members).size !== input.members.length) return null
  if (!input.members.some(isKunPetId) || !input.members.some((id) => !isKunPetId(id))) return null
  return {
    enabled: input.enabled, members: [...input.members], scene: input.scene as PetSceneId,
    autoplay: input.autoplay, paused: input.paused
  }
}
