import { hasKunAccountSession } from '@shared/kun-account'
import { useEffect, useSyncExternalStore } from 'react'
import {
  KUN_AVATAR_PRESETS, normalizeKunAvatarParts, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunWardrobe, type KunWardrobeDetail, type KunWardrobeDrop, type KunWardrobeItemKey,
  type KunWardrobeSettings
} from '@shared/rooms-api'
import type { KunAccountWardrobeApi, KunEconomyFailure, KunEconomyResult } from '@shared/kun-account-economy'
import { roomRequestId, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './room-event-listeners'

/**
 * Who owns the wardrobe: `account` is the signed-in Kun account (the runtime row is its mirror and
 * changes go to the account), `guest` is signed out (default look, login hints), `local` is a debug run.
 */
export type WardrobeMode = 'account' | 'guest' | 'local'
/** One wardrobe per user, shared by every editor, drop card and sidebar entry on screen. */
export type GuestWardrobeHint = { id: string; createdAt: string; roomId?: string; threadId?: string }
export type WardrobeSnapshot = {
  guestHints?: GuestWardrobeHint[];
  wardrobe: KunWardrobe | null; revision: number | null; unlockAll: boolean; mode: WardrobeMode; error: string; loaded: boolean
  /** False until the runtime or the account said who owns the wardrobe; `mode` is only a placeholder before that. */
  modeKnown: boolean
}
type Detail = KunWardrobeDetail & { guestHints?: GuestWardrobeHint[]; unlockAll?: boolean; mode?: WardrobeMode }
export type WardrobeOpenResult = Detail & {
  drops: KunWardrobeDrop[]; drop: KunWardrobeDrop; granted: KunWardrobeItemKey[]; feathers: number; guaranteed: boolean
}

let snapshot: WardrobeSnapshot = { wardrobe: null, revision: null, unlockAll: false, mode: 'guest', error: '', loaded: false, modeKnown: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let accountKnownAnonymous: boolean | undefined
function publish(next: Partial<WardrobeSnapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((listener) => listener())
}
export function acceptWardrobe(detail: Detail) {
  const mode = detail.mode === 'local' ? 'local' : accountKnownAnonymous ? 'guest' : detail.mode ?? snapshot.mode
  const wardrobe = mode === 'guest' ? { ...detail.wardrobe, items: {}, pending: [], roles: [], feathers: 0, history: [] } : detail.wardrobe
  publish({ wardrobe, revision: detail.revision, unlockAll: mode === 'guest' ? false : Boolean(detail.unlockAll ?? snapshot.unlockAll),
    guestHints: mode === 'guest' ? detail.guestHints ?? [] : [], mode, error: '', loaded: true, modeKnown: true })
}

/** A refusal from the Kun account; `code` is a Kunserve rule code such as `not_enough_feathers`. */
export class WardrobeAccountError extends Error {
  constructor(readonly code: KunEconomyFailure) { super(code); this.name = 'WardrobeAccountError' }
}
const accountWardrobe = (): KunAccountWardrobeApi | undefined => typeof window === 'undefined' ? undefined : window.kunGui?.kunAccount?.wardrobe
/** Unwraps an account answer; a wardrobe in it is the new mirror. */
export async function accountResult<T>(call: (api: KunAccountWardrobeApi) => Promise<KunEconomyResult<T>>): Promise<T> {
  const api = accountWardrobe()
  if (!api) throw new WardrobeAccountError('anonymous')
  const result = await call(api)
  if (!result.ok) throw new WardrobeAccountError(result.code)
  const value = result.value as T & Partial<Detail>
  if (value && typeof value === 'object' && value.wardrobe && typeof value.revision === 'number') acceptWardrobe(value as Detail)
  return result.value
}
const signedIn = () => snapshot.mode === 'account'
export const canChangeKunAppearance = () => snapshot.mode !== 'guest'
export function requireKunAppearanceLogin(): boolean {
  if (canChangeKunAppearance()) return true
  void window.kunGui?.kunAccount?.login().catch(() => undefined)
  return false
}
/** Reports finished turns to the account; the runtime queued them and announced it. */
export function syncAccountWardrobe(): void {
  void accountWardrobe()?.sync().catch(() => undefined)
}
export function refreshWardrobe(): Promise<void> {
  if (inflight) return inflight
  inflight = roomsRequest<Detail>('/v1/rooms/wardrobe')
    .then((detail) => { if (detail?.wardrobe) acceptWardrobe(detail) }, (cause) => publish({ error: String(cause), loaded: true }))
    .finally(() => { inflight = null })
  return inflight
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useWardrobe(active = true): WardrobeSnapshot {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.kunGui) return
    void refreshWardrobe()
    let timer: ReturnType<typeof setTimeout> | undefined
    const accountChanged = (account: import('@shared/kun-account').KunAccountState) => {
      accountKnownAnonymous = !hasKunAccountSession(account)
      if (accountKnownAnonymous && snapshot.mode !== 'local') publish({ mode: 'guest', modeKnown: true, unlockAll: false, guestHints: [], wardrobe: snapshot.wardrobe ? { ...snapshot.wardrobe, items: {}, pending: [], roles: [], feathers: 0, history: [] } : null })
      if (account.status === 'authenticated') void refreshWardrobe()
    }
    const offAccount = window.kunGui?.kunAccount?.onState?.(accountChanged)
    void window.kunGui?.kunAccount?.getState?.().then(accountChanged).catch(() => undefined)
    const off = subscribeRoomEvents((event) => {
      if (!event.kind.startsWith('wardrobe.')) return
      if (event.kind === 'wardrobe.activity') syncAccountWardrobe()
      clearTimeout(timer)
      timer = setTimeout(() => { void refreshWardrobe() }, 150)
    })
    return () => { clearTimeout(timer); off(); offAccount?.() }
  }, [active])
  return state
}
/** The wardrobe that gates an editor; null means nothing is locked (still loading, or everything unlocked). */
export function wardrobeGate(state: WardrobeSnapshot): KunWardrobe | null {
  return state.unlockAll ? null : state.wardrobe
}
/** Opens one bottle or a ten-pull; the bottles' contents were fixed when they dropped. */
export async function openWardrobeDrops(dropIds: string[]): Promise<WardrobeOpenResult> {
  if (signedIn()) return accountResult((api) => api.open(dropIds))
  const result = await roomsRequest<WardrobeOpenResult>('/v1/rooms/wardrobe/open', 'POST',
    { dropIds, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision })
  acceptWardrobe(result)
  return result
}
/** Keeps bottles on the shelf; their chat cards stop asking to be opened. */
export async function stashWardrobeDrops(dropIds: string[]): Promise<void> {
  if (signedIn()) { await accountResult((api) => api.stash(dropIds)); return }
  acceptWardrobe(await roomsRequest<Detail>('/v1/rooms/wardrobe/stash', 'POST',
    { dropIds, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision }))
}
/** Bottles waiting on the shelf, oldest first. */
export function wardrobeShelf(wardrobe: KunWardrobe | null): KunWardrobeDrop[] {
  return wardrobe ? [...wardrobe.pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : []
}
export async function markWardrobeSeen(keys: string[]): Promise<void> {
  const unseen = keys.filter((key) => snapshot.wardrobe && !snapshot.wardrobe.seen.includes(key))
  if (!unseen.length) return
  if (signedIn()) { await accountResult((api) => api.seen(unseen)); return }
  acceptWardrobe(await roomsRequest<Detail>('/v1/rooms/wardrobe/seen', 'POST',
    { keys: unseen, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision }))
}
export async function updateWardrobeSettings(settings: Partial<KunWardrobeSettings>): Promise<void> {
  if (signedIn()) { await accountResult((api) => api.settings(settings)); return }
  acceptWardrobe(await roomsRequest<Detail>('/v1/rooms/wardrobe/settings', 'POST',
    { settings, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision }))
}
export type WardrobeDropScope = { roomId?: string; threadId?: string }
/** Bottles that washed up in this conversation (roomId) or this Code task (threadId). */
export function pendingWardrobeDrops(wardrobe: KunWardrobe | null, scope: WardrobeDropScope): KunWardrobeDrop[] {
  return wardrobe?.pending.filter((drop) => !drop.stashedAt && (scope.roomId ? drop.roomId === scope.roomId
    : Boolean(scope.threadId) && drop.threadId === scope.threadId)) ?? []
}
export const wardrobeSettings = (wardrobe: KunWardrobe | null): KunWardrobeSettings =>
  wardrobe?.settings ?? { drops: true, code: true, notice: 'card' }
/** Signed in, a composed look saved as the user's avatar also becomes the account avatar. */
export function syncAccountLook(parts: KunAvatarParts): void {
  if (signedIn()) void accountWardrobe()?.setLook(parts).catch(() => undefined)
}
/** Puts a freshly opened item on the current look; a card replaces the whole outfit but keeps the backdrop. */
export function wearWardrobeDrop(parts: KunAvatarParts, drop: KunWardrobeDrop): KunAvatarParts {
  if (drop.kind === 'card' && drop.cardId) {
    const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId)
    return preset ? normalizeKunAvatarParts({ ...preset.parts, bg: parts.bg }) : parts
  }
  if (!drop.item) return parts
  return updateKunAvatarPart(parts, drop.item.category, drop.item.id as KunAvatarParts[KunAvatarAccessoryCategory]).parts
}
