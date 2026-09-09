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
 *
 * Requests and completions carry generation/key checks: a scan only publishes
 * for the workspace set it was started with, and when the requested roots or
 * an invalidation arrive while a scan is in flight, another scan follows —
 * otherwise a request for set B issued during set A's scan was silently lost,
 * and an invalidation during a scan was cleared by that scan's completion.
 */

export type WikilinkTargetsSnapshot = {
  targets: readonly WikilinkTarget[]
  /** True while a scan is in flight, so the menu can say so. */
  scanning: boolean
  /** Last scan failure. Surfaced rather than swallowed. */
  error: string | null
  /** True when limits or unreadable folders made the last scan incomplete. */
  truncated: boolean
}

const CACHE_TTL_MS = 60_000

let snapshot: WikilinkTargetsSnapshot = {
  targets: [],
  scanning: false,
  error: null,
  truncated: false
}
/** Roots key of the last completed scan; targets belong to this set. */
let cachedKey = ''
let cachedAt = 0
/** Set by invalidation: the targets may be outdated but still describe cachedKey. */
let stale = true
/** Bumped by every invalidation, so a scan can tell one arrived mid-flight. */
let invalidationGeneration = 0
/** The most recent request; a finishing scan re-checks against it. */
let latestRequest: { roots: readonly WikilinkScanRoot[]; list: WikilinkDirectoryLister; key: string } | null = null
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
 * workspaces, just possibly one file out of date. An invalidation that lands
 * while a scan is running survives it: that scan started from the pre-edit
 * tree, so its result must not clear the flag.
 */
export function invalidateWikilinkTargets(): void {
  stale = true
  invalidationGeneration += 1
}

/**
 * Scans on first use. Calls while the cache is fresh for the same workspace
 * set are ignored — this is what keeps several mounted editors from each
 * repeating the walk. A call during an in-flight scan is remembered instead of
 * dropped: when the scan completes, a follow-up scan runs if the requested
 * roots differ from what it scanned.
 */
export function requestWikilinkTargets(
  roots: readonly WikilinkScanRoot[],
  list: WikilinkDirectoryLister | undefined
): void {
  if (typeof list !== 'function') {
    publish({ error: 'workspace listing is unavailable' })
    return
  }
  if (roots.length === 0) {
    publish({ error: 'no Work workspace is open' })
    return
  }
  const key = wikilinkRootsKey(roots)
  latestRequest = { roots, list, key }
  // The in-flight scan's completion re-reads latestRequest and follows up when
  // this request asks for a different set than the one being scanned.
  if (inFlight) return
  if (cachedKey === key && !stale && Date.now() - cachedAt < CACHE_TTL_MS) return
  startScan()
}

function startScan(): void {
  const request = latestRequest
  if (!request) return
  const generation = invalidationGeneration
  // A different workspace set must not keep offering the old set's files; the
  // same set keeps them visible while the rescan runs.
  const keyChanged = cachedKey !== request.key
  publish({ scanning: true, error: null, ...(keyChanged ? { targets: [] } : {}) })
  inFlight = scanAllWorkspaceMarkdown(request.roots, request.list)
    .then((outcome) => {
      cachedKey = request.key
      cachedAt = Date.now()
      // Invalidated mid-scan: the result reflects the pre-edit tree, so the
      // cache stays stale and the follow-up below rescans.
      stale = invalidationGeneration !== generation
      publish({ targets: outcome.targets, truncated: outcome.truncated })
    })
    .catch((scanError: unknown) => {
      // Swallowing this made a broken scan look identical to an empty vault.
      publish({ error: scanError instanceof Error ? scanError.message : String(scanError) })
    })
    .finally(() => {
      inFlight = null
      const followUp = latestRequest !== null &&
        (latestRequest.key !== request.key || (stale && invalidationGeneration !== generation))
      if (followUp) {
        startScan()
        return
      }
      publish({ scanning: false })
    })
}

/** Test-only: returns the service to its initial state. */
export function resetWikilinkTargetsForTests(): void {
  snapshot = { targets: [], scanning: false, error: null, truncated: false }
  cachedKey = ''
  cachedAt = 0
  stale = true
  invalidationGeneration = 0
  latestRequest = null
  inFlight = null
  listeners.clear()
}
