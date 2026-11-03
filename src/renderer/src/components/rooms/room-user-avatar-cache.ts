import { canonicalKunAvatarKey, normalizeKunAvatarParts, type RoomAvatarReference } from '@shared/rooms-api'

/**
 * The user's own avatar, remembered on this machine so the sidebar card and chat bubbles paint the
 * right face on the first frame instead of waiting for the runtime to start and answer.
 *
 * The record holds the last profile the runtime confirmed, the account that owned it, and a few
 * rendered faces keyed by what they were rendered from. A new look replaces the whole record, signing
 * out or switching accounts drops it, and a face whose key no longer matches simply misses.
 */
const STORAGE_KEY = 'kun.rooms.userAvatar.v1'
const MAX_FACES = 6
/** An uploaded portrait is a 128px JPEG of at most 192 KB; a rendered face is a few KB. */
const MAX_FACE_CHARS = 262144

type Remembered = {
  /** Account id; '' until the account state arrived. */
  owner: string
  avatar: RoomAvatarReference
  /** Newest last. */
  faces: Record<string, string>
}

let record: Remembered | null | undefined
let knownOwner: string | null | undefined

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage ?? null } catch { return null }
}

function isReference(value: unknown): value is RoomAvatarReference {
  if (!value || typeof value !== 'object') return false
  const reference = value as Record<string, unknown>
  switch (reference.kind) {
    case 'builtin': return typeof reference.id === 'string'
    case 'uploaded': return typeof reference.attachmentId === 'string'
    case 'harness': return typeof reference.harnessId === 'string'
    case 'composed': return Boolean(reference.parts) && typeof reference.parts === 'object'
    default: return false
  }
}

/** What a look is made of; two references with the same key render the same picture. */
export function userAvatarKey(avatar: RoomAvatarReference): string {
  switch (avatar.kind) {
    case 'composed': return `composed:${canonicalKunAvatarKey(normalizeKunAvatarParts(avatar.parts))}`
    case 'builtin': return `builtin:${avatar.id}`
    case 'uploaded': return `uploaded:${avatar.attachmentId}`
    case 'harness': return `harness:${avatar.harnessId}`
  }
}

function load(): Remembered | null {
  if (record !== undefined) return record
  record = null
  try {
    const raw = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    if (raw?.v === 1 && typeof raw.owner === 'string' && isReference(raw.avatar)) {
      const faces: Record<string, string> = {}
      for (const [key, value] of Object.entries((raw.faces ?? {}) as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length <= MAX_FACE_CHARS) faces[key] = value
      }
      record = { owner: raw.owner, avatar: raw.avatar, faces }
    }
  } catch { /* A damaged record is the same as none. */ }
  return record
}

function save(): void {
  try {
    if (record) storage()?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...record }))
    else storage()?.removeItem(STORAGE_KEY)
  } catch { /* Out of quota or storage off: the next launch just starts from the default face. */ }
}

// Another window may have saved a newer look.
if (typeof window !== 'undefined') {
  window.addEventListener?.('storage', (event) => { if (event.key === STORAGE_KEY || event.key === null) record = undefined })
}

/** The look the last run ended with, or null for the bundled default. */
export function rememberedUserAvatar(): RoomAvatarReference | null {
  return load()?.avatar ?? null
}

/**
 * Records what the runtime says the user wears; null (no look chosen) forgets the old one.
 * Nothing is kept while signed out: a guest always wears the bundled Kun.
 */
export function rememberUserAvatar(avatar: RoomAvatarReference | null): void {
  const current = load()
  if (!avatar || knownOwner === null) {
    if (current) { record = null; save() }
    return
  }
  if (current && userAvatarKey(current.avatar) === userAvatarKey(avatar)) {
    // Same look: keep its faces, and learn who owns it if that was still open.
    if (!current.owner && knownOwner) { current.owner = knownOwner; save() }
    return
  }
  record = { owner: knownOwner ?? '', avatar, faces: {} }
  save()
}

/**
 * Tells the cache which account is signed in (null: nobody). A record that belongs to somebody else,
 * or to nobody now, is dropped; returns whether that happened.
 */
export function reconcileUserAvatarOwner(owner: string | null): boolean {
  knownOwner = owner
  const current = load()
  if (!current) return false
  if (owner === null || (current.owner && current.owner !== owner)) { record = null; save(); return true }
  if (!current.owner) { current.owner = owner; save() }
  return false
}

/** A rendered face of this look, as a data URL, if one was saved. */
export function rememberedFace(avatar: RoomAvatarReference, key: string): string | undefined {
  const current = load()
  return current && userAvatarKey(current.avatar) === userAvatarKey(avatar) ? current.faces[key] : undefined
}

/** Saves a rendered face; it is only kept while `avatar` is still the remembered look. */
export function rememberFace(avatar: RoomAvatarReference, key: string, dataUrl: string): void {
  const current = load()
  if (!current || !dataUrl || dataUrl.length > MAX_FACE_CHARS || userAvatarKey(current.avatar) !== userAvatarKey(avatar)) return
  if (current.faces[key] === dataUrl) return
  delete current.faces[key]
  current.faces[key] = dataUrl
  for (const stale of Object.keys(current.faces).slice(0, -MAX_FACES)) delete current.faces[stale]
  save()
}

/** Re-encodes a rendered picture (a blob or data URL) as a data URL that survives a restart. */
export function faceDataUrl(src: string, pixels: number): Promise<string | undefined> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = pixels
        canvas.getContext('2d')?.drawImage(image, 0, 0, pixels, pixels)
        resolve(canvas.toDataURL('image/png'))
      } catch { resolve(undefined) }
    }
    image.onerror = () => resolve(undefined)
    image.src = src
  })
}

/** Test seam: forget the in-memory copy so the next read goes back to storage. */
export function resetUserAvatarCacheForTests(): void {
  record = undefined
  knownOwner = undefined
}
