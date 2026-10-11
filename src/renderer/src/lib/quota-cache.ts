/**
 * One stale-while-revalidate cache behind every quota surface in the renderer
 * (the composer's subscription popover and the right panel's quota tab). A
 * surface shows whatever the cache holds at once and only asks Kun again when
 * the answer is older than {@link QUOTA_FRESH_MS}, so opening a panel never
 * costs a round trip of its own. Kun's per-account TTL cache sits below this
 * one; this layer only decides whether to ask it.
 */
import { SETTINGS_CHANGED_EVENT } from './keyboard-shortcut-settings'

/** Inside this age an answer is served as is, without any request. */
export const QUOTA_FRESH_MS = 60_000
/** Past this age an answer is no longer shown, so a surface reads as "checking" again. */
export const QUOTA_MAX_STALE_MS = 15 * 60_000
const MAX_ENTRIES = 32

export type QuotaCacheEntry<T> = {
  readonly value: T
  readonly fetchedAt: number
  /** Set when another surface forced a refresh: show this, but re-read it soon. */
  readonly stale: boolean
}

type Staleable = { markStale(): void }

/**
 * Caches that belong together. A manual refresh in one of them asks the
 * vendors again, so the others hold older numbers than Kun now has: they are
 * marked stale and re-read (cheaply, from Kun's refreshed cache).
 */
export class QuotaCacheGroup {
  private readonly members = new Set<Staleable>()
  join(member: Staleable): void { this.members.add(member) }
  markOthersStale(source: Staleable): void {
    for (const member of this.members) if (member !== source) member.markStale()
  }
  markAllStale(): void {
    for (const member of this.members) member.markStale()
  }
}

export const quotaCacheGroup = new QuotaCacheGroup()

// A saved settings change may add, remove or re-key a provider or login: what
// is held is shown until it is read again, but is never trusted as fresh.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(SETTINGS_CHANGED_EVENT, () => quotaCacheGroup.markAllStale())
}

export class QuotaCache<T> implements Staleable {
  private readonly entries = new Map<string, QuotaCacheEntry<T>>()
  private readonly inflight = new Map<string, { promise: Promise<T>; force: boolean }>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: { group?: QuotaCacheGroup; now?: () => number } = {}) {
    ;(options.group ?? quotaCacheGroup).join(this)
  }

  private now(): number { return (this.options.now ?? Date.now)() }

  /** The held entry, or undefined when there is none or it is too old to show. */
  peek = (key: string): QuotaCacheEntry<T> | undefined => {
    const entry = this.entries.get(key)
    return entry && this.now() - entry.fetchedAt <= QUOTA_MAX_STALE_MS ? entry : undefined
  }

  isFresh(entry: QuotaCacheEntry<T>): boolean {
    return !entry.stale && this.now() - entry.fetchedAt < QUOTA_FRESH_MS
  }

  /**
   * The answer for `key`: the held one while fresh, otherwise a request. Callers
   * for the same key share one request; a forced read never joins a plain one,
   * since that one may be answered from an older cache.
   */
  load(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
    const held = this.peek(key)
    if (!force && held && this.isFresh(held)) return Promise.resolve(held.value)
    const pending = this.inflight.get(key)
    if (pending && (pending.force || !force)) return pending.promise
    const promise: Promise<T> = (async () => fetcher())().then((value) => {
      // Only the latest request may write; an older one finishing late is dropped.
      if (this.inflight.get(key)?.promise === promise) this.write(key, value, force)
      return value
    }).finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key)
    })
    this.inflight.set(key, { promise, force })
    return promise
  }

  /** Forget an answer that could not be verified, so it is not shown any more. */
  drop(key: string): void {
    if (this.entries.delete(key)) this.notify()
  }

  markStale(): void {
    if (!this.entries.size) return
    for (const [key, entry] of this.entries) if (!entry.stale) this.entries.set(key, { ...entry, stale: true })
    this.notify()
  }

  clear(): void {
    this.entries.clear()
    this.inflight.clear()
    this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private write(key: string, value: T, force: boolean): void {
    this.entries.delete(key)
    this.entries.set(key, { value, fetchedAt: this.now(), stale: false })
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!)
    this.notify()
    if (force) (this.options.group ?? quotaCacheGroup).markOthersStale(this)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
