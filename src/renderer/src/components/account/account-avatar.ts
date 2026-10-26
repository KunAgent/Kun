import { useEffect, useSyncExternalStore } from 'react'
import type { KunAccountUser } from '@shared/kun-account'

/**
 * Which face the account card wears: the user's own picture (the account photo, or a picture
 * chosen on this machine) or Kun's dressed-up look. With no picture of their own, it is Kun.
 */
export type AccountAvatarSource = 'own' | 'kun'
export type AccountAvatarRecord = Readonly<{
  source: AccountAvatarSource
  /** A picture chosen on this machine; it wins over the account photo. */
  custom: string | null
  /** The account photo last read, kept so the next launch paints it at once. */
  photo: Readonly<{ url: string; data: string }> | null
}>
export type AccountFaceView = { kind: 'image'; src: string } | { kind: 'kun' }

export const ACCOUNT_AVATAR_STORAGE_KEY = 'kun.account.avatar.v1'
export const ACCOUNT_AVATAR_PIXELS = 160
const EMPTY: AccountAvatarRecord = { source: 'own', custom: null, photo: null }
const IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif);base64,/

function readRecord(): AccountAvatarRecord {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_AVATAR_STORAGE_KEY) ?? 'null') as Partial<AccountAvatarRecord> | null
    if (!value || typeof value !== 'object') return EMPTY
    const photo = value.photo && typeof value.photo.url === 'string' && IMAGE_DATA.test(value.photo.data ?? '') ? value.photo : null
    return {
      source: value.source === 'kun' ? 'kun' : 'own',
      custom: typeof value.custom === 'string' && IMAGE_DATA.test(value.custom) ? value.custom : null,
      photo
    }
  } catch { return EMPTY }
}

let record: AccountAvatarRecord | undefined
const listeners = new Set<() => void>()
const current = (): AccountAvatarRecord => (record ??= readRecord())

function write(next: Partial<AccountAvatarRecord>): void {
  record = { ...current(), ...next }
  try { localStorage.setItem(ACCOUNT_AVATAR_STORAGE_KEY, JSON.stringify(record)) } catch { /* Kept for this run only. */ }
  listeners.forEach((listener) => listener())
}

export function useAccountAvatarRecord(): AccountAvatarRecord {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, current, current)
}

export const setAccountAvatarSource = (source: AccountAvatarSource): void => write({ source })
export const setAccountAvatarCustom = (custom: string | null): void => write(custom ? { custom, source: 'own' } : { custom: null })

/** The user's own picture: one chosen here first, then the account photo once it has been read. */
export function ownAccountPicture(value: AccountAvatarRecord, user: KunAccountUser | null): string | null {
  if (value.custom) return value.custom
  return user?.avatarUrl && value.photo?.url === user.avatarUrl ? value.photo.data : null
}

export function resolveAccountFace(value: AccountAvatarRecord, user: KunAccountUser | null): AccountFaceView {
  const own = value.source === 'own' ? ownAccountPicture(value, user) : null
  return own ? { kind: 'image', src: own } : { kind: 'kun' }
}

function dataUrlBlob(url: string): Blob {
  const [head, body = ''] = url.split(',', 2)
  const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: head.slice(5).split(';')[0] })
}

/** Center-crops a picture to a small square so it stays light in localStorage. */
export async function squareAccountPicture(source: Blob | string): Promise<string> {
  // Decoded by hand: the renderer CSP's connect-src does not allow fetching data: URLs.
  const blob = typeof source === 'string' ? dataUrlBlob(source) : source
  const bitmap = await createImageBitmap(blob)
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('empty image')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ACCOUNT_AVATAR_PIXELS
    const side = Math.min(bitmap.width, bitmap.height)
    canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
      0, 0, ACCOUNT_AVATAR_PIXELS, ACCOUNT_AVATAR_PIXELS)
    return canvas.toDataURL('image/webp', 0.9)
  } finally { bitmap.close() }
}

const photoReads = new Map<string, Promise<void>>()

/** Reads the account photo once per URL (main fetches it; the renderer CSP blocks remote images). */
function loadAccountPhoto(url: string): void {
  if (photoReads.has(url)) return
  const api = window.kunGui?.kunAccount
  if (!api?.photo) return
  photoReads.set(url, api.photo().then(async (data) => {
    if (!data) { photoReads.delete(url); return }
    write({ photo: { url, data: await squareAccountPicture(data) } })
  }).catch(() => { photoReads.delete(url) }))
}

/** The face the account card shows for this user, keeping the account photo fresh. */
export function useAccountFace(user: KunAccountUser | null): AccountFaceView {
  const value = useAccountAvatarRecord()
  const url = user?.avatarUrl ?? null
  const stale = Boolean(url && value.photo?.url !== url)
  useEffect(() => { if (url && stale) loadAccountPhoto(url) }, [url, stale])
  return resolveAccountFace(value, user)
}

/** Test seam: forget the in-memory record so the next read comes from storage. */
export function resetAccountAvatarForTests(): void {
  record = undefined
  photoReads.clear()
}
