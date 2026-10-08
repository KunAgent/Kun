import { useEffect, useSyncExternalStore } from 'react'
import {
  KUN_AVATAR_PRESETS, normalizeKunAvatarParts, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunWardrobe, type KunWardrobeDetail, type KunWardrobeDrop, type KunWardrobeItemKey,
  type KunWardrobeSettings
} from '@shared/rooms-api'
import { roomRequestId, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './room-event-listeners'

/** One wardrobe per user, shared by every editor, drop card and sidebar entry on screen. */
export type WardrobeSnapshot = { wardrobe: KunWardrobe | null; revision: number | null; unlockAll: boolean; error: string; loaded: boolean }
type Detail = KunWardrobeDetail & { unlockAll?: boolean }
export type WardrobeOpenResult = Detail & {
  drops: KunWardrobeDrop[]; drop: KunWardrobeDrop; granted: KunWardrobeItemKey[]; feathers: number; guaranteed: boolean
}

let snapshot: WardrobeSnapshot = { wardrobe: null, revision: null, unlockAll: false, error: '', loaded: false }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
function publish(next: Partial<WardrobeSnapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((listener) => listener())
}
export function acceptWardrobe(detail: Detail) {
  publish({ wardrobe: detail.wardrobe, revision: detail.revision, unlockAll: Boolean(detail.unlockAll), error: '', loaded: true })
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
    const off = subscribeRoomEvents((event) => {
      if (!event.kind.startsWith('wardrobe.')) return
      clearTimeout(timer)
      timer = setTimeout(() => { void refreshWardrobe() }, 150)
    })
    return () => { clearTimeout(timer); off() }
  }, [active])
  return state
}
/** The wardrobe that gates an editor; null means nothing is locked (still loading, or everything unlocked). */
export function wardrobeGate(state: WardrobeSnapshot): KunWardrobe | null {
  return state.unlockAll ? null : state.wardrobe
}
/** Opens one bottle or a ten-pull; the bottles' contents were fixed when they dropped. */
export async function openWardrobeDrops(dropIds: string[]): Promise<WardrobeOpenResult> {
  const result = await roomsRequest<WardrobeOpenResult>('/v1/rooms/wardrobe/open', 'POST',
    { dropIds, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision })
  acceptWardrobe(result)
  return result
}
/** Keeps bottles on the shelf; their chat cards stop asking to be opened. */
export async function stashWardrobeDrops(dropIds: string[]): Promise<void> {
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
  acceptWardrobe(await roomsRequest<Detail>('/v1/rooms/wardrobe/seen', 'POST',
    { keys: unseen, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision }))
}
export async function exchangeWardrobeItem(key: KunWardrobeItemKey): Promise<void> {
  acceptWardrobe(await roomsRequest<Detail>('/v1/rooms/wardrobe/exchange', 'POST',
    { key, clientRequestId: roomRequestId(), expectedRevision: snapshot.revision }))
}
export async function updateWardrobeSettings(settings: Partial<KunWardrobeSettings>): Promise<void> {
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
/** Puts a freshly opened item on the current look; a card replaces the whole outfit but keeps the backdrop. */
export function wearWardrobeDrop(parts: KunAvatarParts, drop: KunWardrobeDrop): KunAvatarParts {
  if (drop.kind === 'card' && drop.cardId) {
    const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId)
    return preset ? normalizeKunAvatarParts({ ...preset.parts, bg: parts.bg }) : parts
  }
  if (!drop.item) return parts
  return updateKunAvatarPart(parts, drop.item.category, drop.item.id as KunAvatarParts[KunAvatarAccessoryCategory]).parts
}
