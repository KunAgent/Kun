import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

export const SIDEBAR_PROJECT_FIRST_SEEN_STORAGE_KEY = 'kun.sidebarProjectFirstSeen.v1'

/** First-seen timestamp in ms keyed by workspaceRootIdentityKey. */
export type SidebarProjectFirstSeenRegistry = Record<string, number>

export function readSidebarProjectFirstSeen(): SidebarProjectFirstSeenRegistry {
  try {
    const raw = readBrowserStorageItem(SIDEBAR_PROJECT_FIRST_SEEN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: SidebarProjectFirstSeenRegistry = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveSidebarProjectFirstSeen(registry: SidebarProjectFirstSeenRegistry): void {
  writeBrowserStorageItem(SIDEBAR_PROJECT_FIRST_SEEN_STORAGE_KEY, JSON.stringify(registry))
}

/**
 * Ensures every supplied identity key has a stable first-seen timestamp. Keys
 * already recorded keep their original value; new keys are seeded once from
 * the filesystem creation time (or `Date.now()` when unavailable) and persisted
 * so a later directory mtime change cannot reshuffle the sidebar order.
 */
export function firstSeenTimesFor(
  keys: readonly string[],
  seedTimes: Readonly<Record<string, number>>
): SidebarProjectFirstSeenRegistry {
  const registry = readSidebarProjectFirstSeen()
  let changed = false
  const now = Date.now()
  for (const key of keys) {
    if (!key || Object.prototype.hasOwnProperty.call(registry, key)) continue
    const seed = seedTimes[key]
    registry[key] = typeof seed === 'number' && Number.isFinite(seed) && seed > 0 ? seed : now
    changed = true
  }
  if (changed) saveSidebarProjectFirstSeen(registry)
  return registry
}
