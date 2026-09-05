import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_PROJECT_FIRST_SEEN_STORAGE_KEY,
  firstSeenTimesFor,
  readSidebarProjectFirstSeen
} from './sidebar-project-first-seen'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sidebar project first-seen registry', () => {
  it('seeds from filesystem times on first load and keeps them stable', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)

    const first = firstSeenTimesFor(['d:/a', 'd:/b'], { 'd:/a': 1000, 'd:/b': 2000 })
    expect(first).toEqual({ 'd:/a': 1000, 'd:/b': 2000 })

    // A later fetch reports an advanced directory mtime for the same project;
    // the stored first-seen value must not move.
    const second = firstSeenTimesFor(['d:/a', 'd:/b'], { 'd:/a': 999999, 'd:/b': 2000 })
    expect(second).toEqual({ 'd:/a': 1000, 'd:/b': 2000 })
    expect(readSidebarProjectFirstSeen()).toEqual({ 'd:/a': 1000, 'd:/b': 2000 })
  })

  it('falls back to now when no filesystem time is available', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)

    const before = Date.now()
    const times = firstSeenTimesFor(['d:/new'], {})
    const after = Date.now()

    expect(times['d:/new']).toBeGreaterThanOrEqual(before)
    expect(times['d:/new']).toBeLessThanOrEqual(after)
    expect(readSidebarProjectFirstSeen()).toEqual({ 'd:/new': times['d:/new'] })
  })

  it('reseeds after corrupt storage', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem(SIDEBAR_PROJECT_FIRST_SEEN_STORAGE_KEY, '{not-json')

    const times = firstSeenTimesFor(['d:/a'], { 'd:/a': 500 })
    expect(times).toEqual({ 'd:/a': 500 })
    expect(JSON.parse(storage.getItem(SIDEBAR_PROJECT_FIRST_SEEN_STORAGE_KEY) ?? '{}'))
      .toEqual({ 'd:/a': 500 })
  })
})
