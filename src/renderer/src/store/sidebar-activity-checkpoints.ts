import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

export const SIDEBAR_ACTIVITY_CHECKPOINTS_KEY = 'kun.sidebarActivityCheckpoints.v1'
const MAX_CHECKPOINTS = 1_000

export type ThreadActivityCheckpoint = {
  latestSeq?: number
  fallback: string
}

export type SidebarActivityCheckpoints = {
  initialized: boolean
  threads: Record<string, ThreadActivityCheckpoint>
  scheduleRuns: Record<string, string>
}

const EMPTY: SidebarActivityCheckpoints = {
  initialized: false,
  threads: {},
  scheduleRuns: {}
}

function boundedEntries<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).slice(-MAX_CHECKPOINTS))
}

export function readSidebarActivityCheckpoints(): SidebarActivityCheckpoints {
  const raw = readBrowserStorageItem(SIDEBAR_ACTIVITY_CHECKPOINTS_KEY)
  if (!raw) return { ...EMPTY, threads: {}, scheduleRuns: {} }
  try {
    const value = JSON.parse(raw) as Partial<SidebarActivityCheckpoints>
    return {
      initialized: value.initialized === true,
      threads: value.threads && typeof value.threads === 'object'
        ? boundedEntries(value.threads)
        : {},
      scheduleRuns: value.scheduleRuns && typeof value.scheduleRuns === 'object'
        ? boundedEntries(value.scheduleRuns)
        : {}
    }
  } catch {
    return { ...EMPTY, threads: {}, scheduleRuns: {} }
  }
}

export function persistSidebarActivityCheckpoints(
  value: SidebarActivityCheckpoints
): SidebarActivityCheckpoints {
  const normalized = {
    initialized: true,
    threads: boundedEntries(value.threads),
    scheduleRuns: boundedEntries(value.scheduleRuns)
  }
  writeBrowserStorageItem(SIDEBAR_ACTIVITY_CHECKPOINTS_KEY, JSON.stringify(normalized))
  return normalized
}
