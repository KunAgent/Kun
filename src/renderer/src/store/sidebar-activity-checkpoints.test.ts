import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  persistSidebarActivityCheckpoints,
  readSidebarActivityCheckpoints,
  SIDEBAR_ACTIVITY_CHECKPOINTS_KEY,
  type SidebarActivityCheckpoints
} from './sidebar-activity-checkpoints'

const LEGACY_KEY = 'kun.sidebarActivityCheckpoints.v1'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function checkpoints(
  threads: SidebarActivityCheckpoints['threads'] = {},
  scheduleRuns: SidebarActivityCheckpoints['scheduleRuns'] = {}
): SidebarActivityCheckpoints {
  return { initialized: true, threads, scheduleRuns }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('sidebar activity checkpoints', () => {
  it('keeps the most recently updated thread checkpoint instead of its original insertion position', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const threads = Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [
      `thread-${index}`,
      { checkpoint: { fallback: String(index) }, updatedAt: index }
    ]))
    threads['thread-0'] = { checkpoint: { fallback: 'active' }, updatedAt: 2_000 }

    const persisted = persistSidebarActivityCheckpoints(checkpoints(threads))

    expect(Object.keys(persisted.threads)).toHaveLength(1_000)
    expect(persisted.threads['thread-0']).toEqual({
      checkpoint: { fallback: 'active' }, updatedAt: 2_000
    })
    expect(persisted.threads['thread-1']).toBeUndefined()
  })

  it('applies the same updated-time limit to schedule run checkpoints', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const scheduleRuns = Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [
      `task-${index}`,
      { checkpoint: `run-${index}`, updatedAt: index }
    ]))
    scheduleRuns['task-0'] = { checkpoint: 'active-run', updatedAt: 2_000 }

    const persisted = persistSidebarActivityCheckpoints(checkpoints({}, scheduleRuns))

    expect(Object.keys(persisted.scheduleRuns)).toHaveLength(1_000)
    expect(persisted.scheduleRuns['task-0']).toEqual({ checkpoint: 'active-run', updatedAt: 2_000 })
    expect(persisted.scheduleRuns['task-1']).toBeUndefined()
  })

  it('round-trips v2 and discards malformed timestamped checkpoints', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem(SIDEBAR_ACTIVITY_CHECKPOINTS_KEY, JSON.stringify({
      initialized: true,
      threads: {
        valid: { checkpoint: { latestSeq: 4, fallback: 'current' }, updatedAt: 10 },
        missingTime: { checkpoint: { fallback: 'bad' } },
        invalidCheckpoint: { checkpoint: { fallback: 1 }, updatedAt: 11 }
      },
      scheduleRuns: {
        valid: { checkpoint: 'run', updatedAt: 10 },
        invalidTime: { checkpoint: 'run', updatedAt: 'now' },
        invalidCheckpoint: { checkpoint: 1, updatedAt: 11 }
      }
    }))

    expect(readSidebarActivityCheckpoints()).toEqual(checkpoints(
      { valid: { checkpoint: { latestSeq: 4, fallback: 'current' }, updatedAt: 10 } },
      { valid: { checkpoint: 'run', updatedAt: 10 } }
    ))
  })

  it('migrates v1 without resetting its baseline and writes only v2', () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'))
    storage.setItem(LEGACY_KEY, JSON.stringify({
      initialized: true,
      threads: {
        older: { latestSeq: 2, fallback: 'old' },
        newer: { fallback: 'new' }
      },
      scheduleRuns: { task: '2026-08-20T00:00:00.000Z|completed' }
    }))

    const migrated = readSidebarActivityCheckpoints()
    persistSidebarActivityCheckpoints(migrated)

    expect(migrated.initialized).toBe(true)
    expect(migrated.threads.older.checkpoint).toEqual({ latestSeq: 2, fallback: 'old' })
    expect(migrated.threads.older.updatedAt).toBeLessThan(migrated.threads.newer.updatedAt)
    expect(migrated.scheduleRuns.task.checkpoint).toBe('2026-08-20T00:00:00.000Z|completed')
    expect(storage.getItem(SIDEBAR_ACTIVITY_CHECKPOINTS_KEY)).not.toBeNull()
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull()
  })
})
