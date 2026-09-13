import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { Turn } from './message-timeline-turns'
import { timelineForkPointIndex } from './message-timeline-fork-point'

const turns = (ids: string[]): Turn[] => ids.map((turnId) => ({ turnId, blocks: [] }))
const thread = (extra: Partial<NormalizedThread> = {}): NormalizedThread => ({
  id: 'fork', title: 'Fork', updatedAt: '', model: '', mode: 'agent', historyRefId: 'source',
  forkedFromThreadId: 'parent', forkedFromTurnCount: 2, forkedFromTurnId: 'native-2', ...extra
})

describe('timeline fork boundary', () => {
  it('places the native fork after two native turns regardless of the external prefix', () => {
    const loaded = turns([...Array.from({ length: 10 }, (_, i) => `codex:${i}`), 'native-1', 'native-2', 'new'])
    expect(timelineForkPointIndex(loaded, thread(), false)).toBe(12)
    expect(timelineForkPointIndex(loaded.slice(8), thread(), true)).toBe(4)
    expect(timelineForkPointIndex(loaded.slice(11), thread(), true)).toBe(1)
  })
  it('does not invent a boundary on a later remote page until the cutoff turn loads', () => {
    expect(timelineForkPointIndex(turns(['new-1', 'new-2', 'new-3']), thread(), true)).toBeUndefined()
    expect(timelineForkPointIndex(turns(['native-2', 'new-1', 'new-2']), thread(), true)).toBe(1)
    expect(timelineForkPointIndex(turns(['codex:0', 'native-2']), thread(), true)).toBe(2)
  })
  it('counts only native turns for old reference forks after their prefix is available', () => {
    const legacy = thread({ forkedFromTurnId: undefined })
    expect(timelineForkPointIndex(turns(['codex:0', 'native-1', 'native-2', 'new']), legacy, false)).toBe(3)
    expect(timelineForkPointIndex(turns(['native-2', 'new']), legacy, true)).toBeUndefined()
    expect(timelineForkPointIndex(turns(['codex:0']), thread({ forkedFromTurnId: undefined, forkedFromTurnCount: 0 }), false)).toBe(1)
  })
  it('keeps ordinary legacy fork behavior and omits markers on primary threads', () => {
    const loaded = turns(['native-1', 'native-2', 'new'])
    expect(timelineForkPointIndex(loaded, thread({ historyRefId: undefined, forkedFromTurnId: undefined }), true)).toBe(2)
    expect(timelineForkPointIndex(loaded, thread({ forkedFromThreadId: undefined }), false)).toBeUndefined()
  })
})
