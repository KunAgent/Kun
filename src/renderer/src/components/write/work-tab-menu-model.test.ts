import { describe, expect, it } from 'vitest'
import type { WriteEditorItem } from '../../write/write-workspace-store-types'
import { workTabCloseTargets, workTabMoveNeighbor, type WorkStripEntry } from './work-tab-menu-model'

const session = (id: string): WorkStripEntry => ({ kind: 'session', key: `session:${id}`, id })
const doc = (path: string, groupId: 'primary' | 'secondary' = 'primary'): WorkStripEntry => ({
  kind: 'document',
  key: path,
  groupId,
  item: { kind: 'file', path, viewMode: 'rich' } as WriteEditorItem
})

const strip: WorkStripEntry[] = [session('a'), session('b'), { kind: 'draft', key: 'session:draft' }, doc('one.md'), doc('two.md')]
const keys = (entries: WorkStripEntry[]): string[] => entries.map((entry) => entry.key)

describe('workTabCloseTargets', () => {
  it('closes the tab, the others, the ones to its right, or all, by strip order', () => {
    expect(keys(workTabCloseTargets(strip, 'session:b', 'self'))).toEqual(['session:b'])
    expect(keys(workTabCloseTargets(strip, 'session:b', 'others'))).toEqual(['session:a', 'one.md', 'two.md'])
    expect(keys(workTabCloseTargets(strip, 'session:b', 'right'))).toEqual(['one.md', 'two.md'])
    expect(keys(workTabCloseTargets(strip, 'one.md', 'all'))).toEqual(['session:a', 'session:b', 'one.md', 'two.md'])
  })

  it('never closes the draft and returns nothing for an unknown tab', () => {
    expect(workTabCloseTargets(strip, 'session:draft', 'self')).toEqual([])
    expect(workTabCloseTargets(strip, 'two.md', 'right')).toEqual([])
    expect(workTabCloseTargets(strip, 'missing', 'all')).toEqual([])
  })
})

describe('workTabMoveNeighbor', () => {
  it('swaps only with a neighbour of the same kind', () => {
    expect(workTabMoveNeighbor(strip, 'session:a', 1)?.key).toBe('session:b')
    expect(workTabMoveNeighbor(strip, 'session:a', -1)).toBeNull()
    expect(workTabMoveNeighbor(strip, 'session:b', 1)).toBeNull()
    expect(workTabMoveNeighbor(strip, 'one.md', -1)).toBeNull()
    expect(workTabMoveNeighbor(strip, 'one.md', 1)?.key).toBe('two.md')
  })

  it('keeps documents inside their editor group', () => {
    const split = [doc('one.md'), doc('two.md', 'secondary')]
    expect(workTabMoveNeighbor(split, 'one.md', 1)).toBeNull()
  })
})
