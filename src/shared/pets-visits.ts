import type { PetSceneId } from './pets-ensemble'

export type PetVisitPreferences = { enabled: boolean; frequency: 'quiet' | 'balanced' | 'lively' }
export type PetVisitReason = 'random' | 'model' | 'celebration' | 'break' | 'manual' | 'bottle'
export type PetVisitRequest = {
  id: string; kind: 'invite' | 'dismiss' | 'bottle' | 'clear-bottle'; createdAt: number
  primaryId?: string; scene?: PetSceneId; bottleCount?: number
}
export type PetVisit = {
  id: number
  primaryId: string
  guestIds: string[]
  reason: PetVisitReason
  scene: PetSceneId
  startedAt: number
  playUntil: number
  plannedPlayUntil: number
  endsAt: number
  seed: number
  bottleCount?: number
}

export const PET_VISIT_ARRIVAL_MS = 1600
export const PET_VISIT_DEPARTURE_MS = 1600
export const PET_VISIT_COOLDOWN_MS = 90_000
export const PET_VISIT_REQUEST_TTL_MS = 15_000

export function defaultPetVisits(): PetVisitPreferences { return { enabled: true, frequency: 'balanced' } }

export function parsePetVisitPreferences(value: unknown): PetVisitPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== 'boolean' || !(['quiet', 'balanced', 'lively'] as readonly unknown[]).includes(input.frequency)) return null
  return { enabled: input.enabled, frequency: input.frequency as PetVisitPreferences['frequency'] }
}
