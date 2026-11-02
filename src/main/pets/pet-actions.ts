import type { PetActionRequest, PetActionResult, PetActivityItem, PetActivitySnapshot } from '../../shared/pets'

export type PetThreadRecord = { id: string }

export function resolvePetNavigation(input: {
  request: Extract<PetActionRequest, { type: 'reply' | 'open' }>
  threads: readonly PetThreadRecord[]
}): { threadId: string } | { missing: true } {
  const known = new Set(input.threads.map((thread) => thread.id))
  if (!known.has(input.request.threadId)) return { missing: true }
  return { threadId: input.request.threadId }
}

export function validatePetStop(input: {
  request: Extract<PetActionRequest, { type: 'stop' }>
  snapshot: PetActivitySnapshot | null
}): PetActionResult | null {
  const item = input.snapshot?.items.find((candidate) => matchesStop(candidate, input.request))
  if (!item || item.status !== 'running' || item.turnId !== input.request.turnId) {
    return { ok: false, code: 'conflict', message: 'The shown turn is no longer running.' }
  }
  return null
}

export function petStopConflict(status: number): PetActionResult | null {
  if (status === 409 || status === 404) {
    return { ok: false, code: 'conflict', message: 'Kun refused to interrupt a turn that is no longer current.' }
  }
  if (status >= 400) return { ok: false, code: 'rejected', message: 'Kun could not stop the turn.' }
  return null
}

function matchesStop(item: PetActivityItem, request: Extract<PetActionRequest, { type: 'stop' }>): boolean {
  if (item.threadId !== request.threadId) return false
  if (request.unitId && item.unitId !== request.unitId) return false
  return true
}
