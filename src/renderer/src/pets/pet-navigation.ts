import type { PetActionRequest } from '@shared/pets'

export const PET_OPEN_SETTINGS_EVENT = 'kun-pet-open-settings'

export type PetNavigationResult =
  | { ok: true; threadId: string }
  | { ok: false; reason: 'missing' }

export function resolvePetThreadTarget(input: {
  request: Extract<PetActionRequest, { type: 'reply' | 'open' }>
  knownThreadIds: ReadonlySet<string>
}): PetNavigationResult {
  if (!input.knownThreadIds.has(input.request.threadId)) return { ok: false, reason: 'missing' }
  return { ok: true, threadId: input.request.threadId }
}

export function queuePetNavigation(input: {
  ready: boolean
  request: PetActionRequest
  pending: PetActionRequest | null
}): { pending: PetActionRequest | null; deliver: PetActionRequest | null } {
  if (input.request.type === 'stop') return { pending: input.pending, deliver: null }
  if (!input.ready) return { pending: input.request, deliver: null }
  return { pending: null, deliver: input.request }
}
