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

  it('follows up with a scan for roots requested while another scan was in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slowA: WikilinkDirectoryLister = async (input) => {
      await gate
      return lister(['a.md'])(input)
    }
    const listB = vi.fn(lister(['b.md']))
    requestWikilinkTargets(ROOTS, slowA)
    // Workspace set B arrives while A is still scanning. Before the generation
    // fix this request was silently discarded: A's result was published for
    // the wrong set and no scan for B ever ran.
    requestWikilinkTargets([{ root: '/other', name: 'other' }], listB)
    release()
    await settled()
    expect(listB).toHaveBeenCalled()
    expect(getWikilinkTargetsSnapshot().targets.map((target) => target.name)).toEqual(['b.md'])
    expect(getWikilinkTargetsSnapshot().scanning).toBe(false)
  })

  it('keeps an invalidation that lands during a scan and rescans for it', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let scans = 0
    const slow: WikilinkDirectoryLister = async (input) => {
      scans += 1
      await gate
      return lister([`pass-${scans}.md`])(input)
    }
    requestWikilinkTargets(ROOTS, slow)
    // The file tree changes mid-scan: the in-flight result describes the
    // pre-edit tree. Before the fix the completing scan cleared the stale
    // flag and the invalidation was lost.
    invalidateWikilinkTargets()
    release()
    await settled()
    expect(scans).toBe(2)
    expect(getWikilinkTargetsSnapshot().targets.map((target) => target.name)).toEqual(['pass-2.md'])
  })

  it('surfaces a truncated scan on the snapshot', async () => {
    // More files than the total budget allows: the walk stops early and must
    // say so, or an empty result reads as an empty vault.
    const many = Array.from({ length: 3_300 }, (_, index) => `note-${index}.md`)
    requestWikilinkTargets(ROOTS, lister(many))
    await settled()
    expect(getWikilinkTargetsSnapshot().truncated).toBe(true)
    expect(getWikilinkTargetsSnapshot().targets.length).toBeGreaterThan(0)
  })
})
