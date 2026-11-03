import {
  PET_DISMISSED_KEY_LIMIT,
  clampMascotWidth,
  type PetActionRequest,
  type PetActivitySnapshot,
  type PetSettings
} from './pets'

const MAX_ACTIVITY_ITEMS = 64
const MAX_TEXT = 512

export type PetPayloadResult<T> = { ok: true; value: T } | { ok: false; error: string }

function text(value: unknown, field: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_TEXT) return null
  return trimmed
}

export function parsePetSelectPayload(value: unknown): PetPayloadResult<string | null> {
  if (value === null) return { ok: true, value: null }
  const id = text(value, 'petId')
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    return { ok: false, error: 'invalid pet id' }
  }
  return { ok: true, value: id }
}

export function parsePetOverlayOpenPayload(value: unknown): PetPayloadResult<boolean> {
  if (typeof value !== 'boolean') return { ok: false, error: 'overlay open must be boolean' }
  return { ok: true, value }
}

export function parsePetImportPreferences(value: unknown): PetPayloadResult<{ importCodexPets?: boolean }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid import preferences' }
  }
  const candidate = value as Record<string, unknown>
  if ('importCodexPets' in candidate && typeof candidate.importCodexPets !== 'boolean') {
    return { ok: false, error: 'importCodexPets must be boolean' }
  }
  return {
    ok: true,
    value: typeof candidate.importCodexPets === 'boolean' ? { importCodexPets: candidate.importCodexPets } : {}
  }
}

export function parsePetDismissPayload(value: unknown): PetPayloadResult<{ key: string }> {
  if (!value || typeof value !== 'object') return { ok: false, error: 'invalid dismiss payload' }
  const key = text((value as { key?: unknown }).key, 'key')
  if (!key || key.length > 300) return { ok: false, error: 'invalid dismiss key' }
  return { ok: true, value: { key } }
}

export function parsePetMascotWidth(value: unknown): PetPayloadResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'invalid mascot width' }
  return { ok: true, value: clampMascotWidth(value) }
}

export function parsePetActionRequest(value: unknown): PetPayloadResult<PetActionRequest> {
  if (!value || typeof value !== 'object') return { ok: false, error: 'invalid pet action' }
  const candidate = value as Record<string, unknown>
  const threadId = text(candidate.threadId, 'threadId')
  if (!threadId) return { ok: false, error: 'invalid thread id' }
  const unitId = candidate.unitId === undefined ? undefined : text(candidate.unitId, 'unitId') ?? undefined
  const roomId = candidate.roomId === undefined ? undefined : text(candidate.roomId, 'roomId') ?? undefined
  if (candidate.type === 'stop') {
    const turnId = text(candidate.turnId, 'turnId')
    if (!turnId) return { ok: false, error: 'invalid turn id' }
    return { ok: true, value: { type: 'stop', threadId, turnId, ...(unitId ? { unitId } : {}) } }
  }
  if (candidate.type === 'follow-up') {
    if (typeof candidate.prompt !== 'string') return { ok: false, error: 'invalid follow-up' }
    const prompt = candidate.prompt.trim()
    if (!prompt || prompt.length > 16_000) return { ok: false, error: 'invalid follow-up' }
    return { ok: true, value: { type: 'follow-up', threadId, prompt, ...(unitId ? { unitId } : {}), ...(roomId ? { roomId } : {}) } }
  }
  if (candidate.type === 'reply' || candidate.type === 'open') {
    return {
      ok: true,
      value: {
        type: candidate.type,
        threadId,
        ...(unitId ? { unitId } : {}),
        ...(roomId ? { roomId } : {})
      }
    }
  }
  return { ok: false, error: 'unsupported pet action' }
}

export function parsePetActivitySnapshot(value: unknown): PetPayloadResult<PetActivitySnapshot> {
  if (!value || typeof value !== 'object') return { ok: false, error: 'invalid activity snapshot' }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.generation !== 'number' || !Number.isInteger(candidate.generation) || candidate.generation < 0) {
    return { ok: false, error: 'invalid activity generation' }
  }
  const profileKey = text(candidate.profileKey, 'profileKey')
  if (!profileKey) return { ok: false, error: 'invalid profile key' }
  if (!Array.isArray(candidate.items) || candidate.items.length > MAX_ACTIVITY_ITEMS) {
    return { ok: false, error: 'invalid activity items' }
  }
  const items: PetActivitySnapshot['items'] = []
  for (const item of candidate.items) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'invalid activity item' }
    const row = item as Record<string, unknown>
    const status = row.status
    if (status !== 'running' && status !== 'waiting' && status !== 'failed' && status !== 'review') {
      return { ok: false, error: 'invalid activity status' }
    }
    const threadId = text(row.threadId, 'threadId')
    const unitId = text(row.unitId, 'unitId')
    const stateSince = text(row.stateSince, 'stateSince')
    const title = text(row.title, 'title')
    const key = text(row.key, 'key')
    if (!threadId || !unitId || !stateSince || !title || !key) return { ok: false, error: 'incomplete activity item' }
    if (typeof row.updatedAtMs !== 'number' || !Number.isFinite(row.updatedAtMs)) {
      return { ok: false, error: 'invalid activity timestamp' }
    }
    items.push({
      key,
      generation: candidate.generation,
      status,
      threadId,
      unitId,
      ...(typeof row.ownerThreadId === 'string' ? { ownerThreadId: row.ownerThreadId } : {}),
      ...(typeof row.roomId === 'string' ? { roomId: row.roomId } : {}),
      turnId: typeof row.turnId === 'string' ? row.turnId : null,
      stateSince,
      title,
      ...(typeof row.subtitle === 'string' ? { subtitle: row.subtitle.slice(0, MAX_TEXT) } : {}),
      stalled: row.stalled === true,
      navigable: row.navigable !== false,
      bubbleAllowed: row.bubbleAllowed !== false,
      updatedAtMs: row.updatedAtMs
    })
  }
  return {
    ok: true,
    value: {
      generation: candidate.generation,
      profileKey,
      items,
      emittedAtMs: typeof candidate.emittedAtMs === 'number' ? candidate.emittedAtMs : Date.now()
    }
  }
}

export function boundDismissedKeys(keys: readonly string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    if (typeof key !== 'string' || seen.has(key)) continue
    seen.add(key)
    unique.push(key)
  }
  return unique.slice(-PET_DISMISSED_KEY_LIMIT)
}

export function settingsKeepSelection(settings: PetSettings, selectedPetId: string | null): boolean {
  return settings.selectedPetId === selectedPetId
}
