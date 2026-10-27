/**
 * A New-session click that lands on an already-empty thread reuses it, so the
 * sidebar must still show the click as recent activity without rewriting the
 * thread's real `updatedAt` (content/creation truth) or the runtime snapshot.
 * This registry keeps that renderer-local "last activated as a new session"
 * time per thread and survives reloads; display time is the later of the two.
 */
import type { NormalizedThread } from '../agent/types'
import { browserStorage, type BrowserStorageLike } from './browser-storage'

export type EmptyThreadActivationRegistry = {
  version: 1
  /** Thread id -> ISO timestamp of the last New-session activation. */
  activatedAt: Record<string, string>
}

export const EMPTY_THREAD_ACTIVATION_STORAGE_KEY = 'kun.emptyThreadActivation.v1'
export const MAX_EMPTY_THREAD_ACTIVATION_ENTRIES = 200

/** A pending promo placement older than this is stale; the row already moved. */
const PROMOTION_TTL_MS = 5 * 60_000
const MAX_PENDING_PROMOTIONS = 64

export function emptyThreadActivationRegistry(): EmptyThreadActivationRegistry {
  return { version: 1, activatedAt: {} }
}

function normalizeThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

export function normalizeEmptyThreadActivationRegistry(
  raw: unknown
): EmptyThreadActivationRegistry {
  if (!raw || typeof raw !== 'object') return emptyThreadActivationRegistry()
  const source = raw as { activatedAt?: unknown }
  if (!source.activatedAt || typeof source.activatedAt !== 'object') {
    return emptyThreadActivationRegistry()
  }
  // Keep the newest entries only: the registry is a recency hint, not history.
  const entries = Object.entries(source.activatedAt as Record<string, unknown>)
    .map(([threadId, value]) => [normalizeThreadId(threadId), normalizedTimestamp(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0]) && Boolean(entry[1]))
    .sort((left, right) => Date.parse(left[1]) - Date.parse(right[1]))
    .slice(-MAX_EMPTY_THREAD_ACTIVATION_ENTRIES)
  return { version: 1, activatedAt: Object.fromEntries(entries) }
}

export function readEmptyThreadActivationRegistry(
  storage: BrowserStorageLike | null = browserStorage()
): EmptyThreadActivationRegistry {
  if (!storage) return emptyThreadActivationRegistry()
  try {
    const raw = storage.getItem(EMPTY_THREAD_ACTIVATION_STORAGE_KEY)
    return normalizeEmptyThreadActivationRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyThreadActivationRegistry()
  }
}

export function saveEmptyThreadActivationRegistry(
  registry: EmptyThreadActivationRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(EMPTY_THREAD_ACTIVATION_STORAGE_KEY, JSON.stringify(registry))
  } catch {
    /* a full quota must not break starting a session */
  }
}

/** Hot-path cache: sidebar sorting and row labels read it many times per render. */
let cached: EmptyThreadActivationRegistry | null = null

function registry(): EmptyThreadActivationRegistry {
  cached ??= readEmptyThreadActivationRegistry()
  return cached
}

export function hydrateEmptyThreadActivations(
  storage: BrowserStorageLike | null = browserStorage()
): EmptyThreadActivationRegistry {
  cached = readEmptyThreadActivationRegistry(storage)
  return cached
}

export function emptyThreadActivatedAtMs(threadId: string | null | undefined): number {
  const id = normalizeThreadId(threadId)
  if (!id) return 0
  const value = Date.parse(registry().activatedAt[id] ?? '')
  return Number.isFinite(value) ? value : 0
}

/**
 * Record that this thread served a New-session click. Only the recency hint
 * moves; `updatedAt` stays the thread's real content timestamp.
 */
export function noteEmptyThreadActivated(
  threadId: string,
  at: Date | number = new Date(),
  storage: BrowserStorageLike | null = browserStorage()
): void {
  const id = normalizeThreadId(threadId)
  if (!id) return
  const when = typeof at === 'number' ? at : at.getTime()
  if (!Number.isFinite(when)) return
  const next = normalizeEmptyThreadActivationRegistry({
    activatedAt: { ...registry().activatedAt, [id]: new Date(when).toISOString() }
  })
  cached = next
  saveEmptyThreadActivationRegistry(next, storage)
}

export function forgetEmptyThreadActivations(
  threadIds: string | readonly string[],
  storage: BrowserStorageLike | null = browserStorage()
): void {
  const ids = (Array.isArray(threadIds) ? threadIds : [threadIds])
    .map(normalizeThreadId)
    .filter(Boolean)
  if (ids.length === 0) return
  const activatedAt = { ...registry().activatedAt }
  let changed = false
  for (const id of ids) {
    if (!(id in activatedAt)) continue
    delete activatedAt[id]
    changed = true
  }
  if (!changed) return
  cached = { version: 1, activatedAt }
  saveEmptyThreadActivationRegistry(cached, storage)
}

/** Later of the real `updatedAt` and this thread's last New-session activation. */
export function threadDisplayUpdatedAt(
  thread: Pick<NormalizedThread, 'id' | 'updatedAt'>
): string {
  const real = Date.parse(thread.updatedAt)
  const activated = emptyThreadActivatedAtMs(thread.id)
  if (!Number.isFinite(real)) return activated > 0 ? new Date(activated).toISOString() : thread.updatedAt
  if (activated <= real) return thread.updatedAt
  return new Date(activated).toISOString()
}

export function threadDisplayUpdatedAtMs(
  thread: Pick<NormalizedThread, 'id' | 'updatedAt'>
): number {
  const value = Date.parse(threadDisplayUpdatedAt(thread))
  return Number.isFinite(value) ? value : 0
}

const pendingPromotions = new Map<string, number>()

/**
 * Ask the sidebar to move one row to the head of its normal-priority bucket.
 * Only a New-session activation raises this; ordinary timestamp refreshes must
 * keep the list stable under the pointer.
 */
export function requestSidebarThreadPromotion(threadId: string, now = Date.now()): void {
  const id = normalizeThreadId(threadId)
  if (!id) return
  pendingPromotions.delete(id)
  pendingPromotions.set(id, now)
  while (pendingPromotions.size > MAX_PENDING_PROMOTIONS) {
    const oldest = pendingPromotions.keys().next().value
    if (oldest === undefined) break
    pendingPromotions.delete(oldest)
  }
}

/** Promotion ids that belong to this container, oldest request first. */
export function matchingSidebarThreadPromotions(
  threadIds: Iterable<string>,
  now = Date.now()
): string[] {
  const present = new Set<string>()
  for (const id of threadIds) present.add(normalizeThreadId(id))
  const matched: Array<[string, number]> = []
  for (const [id, requestedAt] of pendingPromotions) {
    if (now - requestedAt > PROMOTION_TTL_MS) {
      pendingPromotions.delete(id)
      continue
    }
    if (present.has(id)) matched.push([id, requestedAt])
  }
  return matched.sort((left, right) => left[1] - right[1]).map(([id]) => id)
}

/** Consume a promotion once the container that owns the row applied it. */
export function clearSidebarThreadPromotion(threadId: string): void {
  pendingPromotions.delete(normalizeThreadId(threadId))
}

export function resetSidebarThreadPromotions(): void {
  pendingPromotions.clear()
}
