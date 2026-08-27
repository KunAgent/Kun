import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WikilinkDirectoryLister } from './wikilink-scan'
import {
  getWikilinkTargetsSnapshot,
  invalidateWikilinkTargets,
  requestWikilinkTargets,
  resetWikilinkTargetsForTests,
  subscribeWikilinkTargets
} from './wikilink-target-service'

const ROOTS = [{ root: '/vault', name: 'vault' }]

function lister(names: string[]): WikilinkDirectoryLister {
  return async ({ path }) => ({
    ok: true,
    entries: path
      ? []
      : names.map((name) => ({ name, path: name, type: 'file' as const, ext: '.md' }))
  })
}

async function settled(): Promise<void> {
  // The scan resolves through a chain of awaits; drain enough microtask turns
  // for the module state to publish.
  for (let turn = 0; turn < 25; turn += 1) await Promise.resolve()
}

beforeEach(() => {
  resetWikilinkTargetsForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('wikilink target service', () => {
  it('scans once for any number of requesters with the same roots', async () => {
    const list = vi.fn(lister(['a.md']))
    requestWikilinkTargets(ROOTS, list)
    requestWikilinkTargets(ROOTS, list)
    await settled()
    requestWikilinkTargets(ROOTS, list)
    await settled()
    expect(list).toHaveBeenCalledTimes(1)
    expect(getWikilinkTargetsSnapshot().targets.map((target) => target.name)).toEqual(['a.md'])
  })

  it('rescans after the cache TTL passes', async () => {
    const list = vi.fn(lister(['a.md']))
    requestWikilinkTargets(ROOTS, list)
    await settled()
    vi.advanceTimersByTime(61_000)
    requestWikilinkTargets(ROOTS, list)
    await settled()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('rescans after an explicit invalidation', async () => {
    const list = vi.fn(lister(['a.md']))
    requestWikilinkTargets(ROOTS, list)
    await settled()
    invalidateWikilinkTargets()
    requestWikilinkTargets(ROOTS, list)
    await settled()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('keeps stale targets visible during a same-roots rescan, resets them on a roots change', async () => {
    requestWikilinkTargets(ROOTS, lister(['a.md']))
    await settled()
    invalidateWikilinkTargets()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow: WikilinkDirectoryLister = async (input) => {
      await gate
      return lister(['b.md'])(input)
    }
    requestWikilinkTargets(ROOTS, slow)
    // Same workspace set: the old list stays useful while the rescan runs.
    expect(getWikilinkTargetsSnapshot().targets.map((target) => target.name)).toEqual(['a.md'])
    release()
    await settled()
    expect(getWikilinkTargetsSnapshot().targets.map((target) => target.name)).toEqual(['b.md'])

    // A different workspace set must not keep offering the old set's files.
    requestWikilinkTargets([{ root: '/other', name: 'other' }], lister(['c.md']))
    expect(getWikilinkTargetsSnapshot().targets).toEqual([])
    await settled()
    expect(getWikilinkTargetsSnapshot().targets.map((target) => target.name)).toEqual(['c.md'])
  })

  it('notifies subscribers through the scan lifecycle', async () => {
    const events: string[] = []
    subscribeWikilinkTargets(() => {
      const snapshot = getWikilinkTargetsSnapshot()
      events.push(`${snapshot.scanning ? 'scanning' : 'idle'}:${snapshot.targets.length}`)
    })
    requestWikilinkTargets(ROOTS, lister(['a.md']))
    expect(events[0]).toBe('scanning:0')
    await settled()
    expect(events.at(-1)).toBe('idle:1')
  })

  it('reports a missing lister and an empty workspace list without scanning', async () => {
    requestWikilinkTargets(ROOTS, undefined)
    expect(getWikilinkTargetsSnapshot().error).toBe('workspace listing is unavailable')
    requestWikilinkTargets([], lister([]))
    expect(getWikilinkTargetsSnapshot().error).toBe('no Work workspace is open')
  })
})
