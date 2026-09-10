import { describe, expect, it } from 'vitest'
import { kokoroThreadOptions } from './local-kokoro-worker-entry'

describe('kokoroThreadOptions', () => {
  it('leaves half the cores for the rest of the app', () => {
    expect(kokoroThreadOptions(2)).toEqual({ intraOpNumThreads: 1, interOpNumThreads: 1 })
    expect(kokoroThreadOptions(4)).toEqual({ intraOpNumThreads: 2, interOpNumThreads: 1 })
    expect(kokoroThreadOptions(6)).toEqual({ intraOpNumThreads: 3, interOpNumThreads: 1 })
  })

  // More than four intra-op threads measured no faster on this graph, and the
  // extra threads are what let a burst take the whole machine.
  it('caps the intra-op pool on a large machine', () => {
    expect(kokoroThreadOptions(10).intraOpNumThreads).toBe(4)
    expect(kokoroThreadOptions(128).intraOpNumThreads).toBe(4)
  })

  it('always asks for at least one thread', () => {
    expect(kokoroThreadOptions(1).intraOpNumThreads).toBe(1)
    expect(kokoroThreadOptions(0).intraOpNumThreads).toBe(1)
    expect(kokoroThreadOptions(Number.NaN).intraOpNumThreads).toBe(1)
  })
})
