import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

export const SIDEBAR_ACTIVITY_CHECKPOINTS_KEY = 'kun.sidebarActivityCheckpoints.v2'
const LEGACY_SIDEBAR_ACTIVITY_CHECKPOINTS_KEY = 'kun.sidebarActivityCheckpoints.v1'
const MAX_CHECKPOINTS = 1_000

export type ThreadActivityCheckpoint = {
  latestSeq?: number
  fallback: string
}

export type TimestampedCheckpoint<T> = {
  checkpoint: T
  updatedAt: number
}

export type SidebarActivityCheckpoints = {
  initialized: boolean
  threads: Record<string, TimestampedCheckpoint<ThreadActivityCheckpoint>>
  scheduleRuns: Record<string, TimestampedCheckpoint<string>>
}

type LegacySidebarActivityCheckpoints = {
  initialized: boolean
  threads: Record<string, ThreadActivityCheckpoint>
  scheduleRuns: Record<string, string>
}

const EMPTY: SidebarActivityCheckpoints = {
  initialized: false,
  threads: {},
  scheduleRuns: {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isThreadCheckpoint(value: unknown): value is ThreadActivityCheckpoint {
  return isRecord(value) && typeof value.fallback === 'string' &&
    (value.latestSeq === undefined || typeof value.latestSeq === 'number')
}

function boundedEntries<T>(
  value: unknown,
  isCheckpoint: (checkpoint: unknown) => checkpoint is T
): Record<string, TimestampedCheckpoint<T>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([id, entry], index) => {
        if (!isRecord(entry) || !Number.isFinite(entry.updatedAt) || !isCheckpoint(entry.checkpoint)) {
          return []
        }
        return [{ id, entry: entry as TimestampedCheckpoint<T>, index }]
      })
      .sort((left, right) => left.entry.updatedAt - right.entry.updatedAt || left.index - right.index)
      .slice(-MAX_CHECKPOINTS)
      .map(({ id, entry }) => [id, entry])
  )
}

function parseLegacy(raw: string): LegacySidebarActivityCheckpoints | null {
  try {
    const value = JSON.parse(raw) as Partial<LegacySidebarActivityCheckpoints>
    return {
      initialized: value.initialized === true,
      threads: isRecord(value.threads)
        ? Object.fromEntries(Object.entries(value.threads).filter(([, checkpoint]) =>
          isThreadCheckpoint(checkpoint)
        ))
        : {},
      scheduleRuns: isRecord(value.scheduleRuns)
        ? Object.fromEntries(Object.entries(value.scheduleRuns).filter(([, checkpoint]) =>
          typeof checkpoint === 'string'
        ))
        : {}
    }
  } catch {
    return null
  }
}

function timestampLegacyEntries<T>(
  entries: Record<string, T>,
  now: number
): Record<string, TimestampedCheckpoint<T>> {
  const values = Object.entries(entries)
  return Object.fromEntries(values.map(([id, checkpoint], index) => [id, {
    checkpoint,
    updatedAt: now - values.length + index
  }]))
}

function migrateLegacy(raw: string): SidebarActivityCheckpoints | null {
  const legacy = parseLegacy(raw)
  if (!legacy) return null
  const now = Date.now()
  return {
    initialized: legacy.initialized,
    threads: timestampLegacyEntries(legacy.threads, now),
    scheduleRuns: timestampLegacyEntries(legacy.scheduleRuns, now)
  }
}

export function readSidebarActivityCheckpoints(): SidebarActivityCheckpoints {
  const raw = readBrowserStorageItem(SIDEBAR_ACTIVITY_CHECKPOINTS_KEY)
  if (raw !== null) {
    try {
      const value = JSON.parse(raw) as Partial<SidebarActivityCheckpoints>
      return {
        initialized: value.initialized === true,
        threads: boundedEntries(value.threads, isThreadCheckpoint),
        scheduleRuns: boundedEntries(value.scheduleRuns, (checkpoint): checkpoint is string =>
          typeof checkpoint === 'string'
        )
      }
    } catch {
      return { ...EMPTY, threads: {}, scheduleRuns: {} }
    }
  }

  const legacyRaw = readBrowserStorageItem(LEGACY_SIDEBAR_ACTIVITY_CHECKPOINTS_KEY)
  return legacyRaw === null
    ? { ...EMPTY, threads: {}, scheduleRuns: {} }
    : migrateLegacy(legacyRaw) ?? { ...EMPTY, threads: {}, scheduleRuns: {} }
}

export function persistSidebarActivityCheckpoints(
  value: SidebarActivityCheckpoints
): SidebarActivityCheckpoints {
  const normalized = {
    initialized: true,
    threads: boundedEntries(value.threads, isThreadCheckpoint),
    scheduleRuns: boundedEntries(value.scheduleRuns, (checkpoint): checkpoint is string =>
      typeof checkpoint === 'string'
    )
  }
  writeBrowserStorageItem(SIDEBAR_ACTIVITY_CHECKPOINTS_KEY, JSON.stringify(normalized))
  return normalized
}
