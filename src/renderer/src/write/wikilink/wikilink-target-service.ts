import { scanAllWorkspaceMarkdown, type WikilinkDirectoryLister, type WikilinkScanRoot } from './wikilink-scan'
import { toPosix, type WikilinkTarget } from './wikilink-targets'

/**
 * Workspace-level cache of `[[` menu targets, shared by every mounted editor.
 *
 * The scan behind it costs one directory IPC round trip per folder, so it must
 * run at most once per workspace set no matter how many editor groups are open
 * — a hook-local cache repeated the whole walk per editor. State lives here at
 * module level and hooks subscribe via `useSyncExternalStore`.
 *
 * The cache is invalidated by workspace-list changes (the key no longer
 * matches), by file create/rename/delete actions (`invalidateWikilinkTargets`),
 * and by a TTL that catches edits made outside the app.
 */

export type WikilinkTargetsSnapshot = {
  targets: readonly WikilinkTarget[]
  /** True while a scan is in flight, so the menu can say so. */
  scanning: boolean
  /** Last scan failure. Surfaced rather than swallowed. */
  error: string | null
}

const CACHE_TTL_MS = 60_000

let snapshot: WikilinkTargetsSnapshot = { targets: [], scanning: false, error: null }
/** Roots key of the last completed scan; targets belong to this set. */
let cachedKey = ''
let cachedAt = 0
/** Set by invalidation: the targets may be outdated but still describe cachedKey. */
let stale = true
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: Partial<WikilinkTargetsSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of [...listeners]) listener()
}

export function subscribeWikilinkTargets(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWikilinkTargetsSnapshot(): WikilinkTargetsSnapshot {
  return snapshot
}

export function wikilinkRootsKey(roots: readonly WikilinkScanRoot[]): string {
  return roots.map((entry) => toPosix(entry.root).replace(/\/+$/, '')).filter(Boolean).sort().join(' ')
}

/**
 * Discards the cache so the next request rescans. Cheap to call from any file
 * mutation; the rescan itself does not happen until a menu asks for targets.
 * The current targets stay visible meanwhile — they still describe the same
 * workspaces, just possibly one file out of date.
 */
export function invalidateWikilinkTargets(): void {
  stale = true
}

/**
 * Scans on first use. Calls while a scan is in flight, or while the cache is
 * fresh for the same workspace set, are ignored — this is what keeps several
 * mounted editors from each repeating the walk.
 */
export function requestWikilinkTargets(
  roots: readonly WikilinkScanRoot[],
  list: WikilinkDirectoryLister | undefined
): void {
  if (inFlight) return
  if (typeof list !== 'function') {
    publish({ error: 'workspace listing is unavailable' })
    return
  }
  if (roots.length === 0) {
    publish({ error: 'no Work workspace is open' })
    return
  }
  const key = wikilinkRootsKey(roots)
  if (cachedKey === key && !stale && Date.now() - cachedAt < CACHE_TTL_MS) return
  // A different workspace set must not keep offering the old set's files; the
  // same set keeps them visible while the rescan runs.
  const keyChanged = cachedKey !== key
  publish({ scanning: true, error: null, ...(keyChanged ? { targets: [] } : {}) })
  inFlight = scanAllWorkspaceMarkdown(roots, list)
    .then((found) => {
      cachedKey = key
      cachedAt = Date.now()
      stale = false
      publish({ targets: found })
    })
    .catch((scanError: unknown) => {
      // Swallowing this made a broken scan look identical to an empty vault.
      publish({ error: scanError instanceof Error ? scanError.message : String(scanError) })
    })
    .finally(() => {
      inFlight = null
      publish({ scanning: false })
    })
}

/** Test-only: returns the service to its initial state. */
export function resetWikilinkTargetsForTests(): void {
  snapshot = { targets: [], scanning: false, error: null }
  cachedKey = ''
  cachedAt = 0
  stale = true
  inFlight = null
  listeners.clear()
}
