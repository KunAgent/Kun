import type { PetAnimationState } from './pets'

export const PET_BOTTLE_TTL_MS = 15_000
export const PET_BOTTLE_BATCH_LIMIT = 20
export type PetBottleDrop = { dropIds: string[]; occurredAt: number }
export type PetBottleRecipe = {
  catchStyle: 'careful' | 'bounce'
  inspectState: PetAnimationState
  celebrateState: PetAnimationState
  durationMs: number
}

export function defaultPetBottleRecipe(): PetBottleRecipe {
  return { catchStyle: 'careful', inspectState: 'waiting', celebrateState: 'jumping', durationMs: 8200 }
}

/** No contents, rarity, account details or rewards cross the pet bridge. */
export function parsePetBottleDrop(value: unknown, now = Date.now()): PetBottleDrop | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.dropIds) || input.dropIds.length < 1 || input.dropIds.length > PET_BOTTLE_BATCH_LIMIT ||
    !input.dropIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id && Array.from(id).every((character) => character.charCodeAt(0) >= 32)) ||
    new Set(input.dropIds).size !== input.dropIds.length) return null
  if (typeof input.occurredAt !== 'number' || !Number.isFinite(input.occurredAt) ||
    input.occurredAt > now + 1000 || now - input.occurredAt > PET_BOTTLE_TTL_MS) return null
  return { dropIds: [...input.dropIds], occurredAt: input.occurredAt }
}
