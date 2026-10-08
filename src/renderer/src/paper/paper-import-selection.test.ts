import { beforeEach, describe, expect, it } from 'vitest'
import { selectionHas, usePaperImportSelection } from './paper-import-selection'

const store = (): ReturnType<typeof usePaperImportSelection.getState> => usePaperImportSelection.getState()

describe('paper import selection', () => {
  beforeEach(() => usePaperImportSelection.setState({ byScope: {}, seeded: {} }))

  it('matches a paper through any of its identity keys', () => {
    store().toggle('s', ['doi:10.1/x', 'title:a b'])
    expect(selectionHas(store().byScope.s ?? [], ['title:a b'])).toBe(true)
    expect(selectionHas(store().byScope.s ?? [], ['arxiv:1'])).toBe(false)
  })

  it('deselecting from a view with fewer keys clears the whole paper', () => {
    store().toggle('s', ['doi:10.1/x', 'arxiv:1', 'title:a b'])
    store().toggle('s', ['title:a b'])
    expect(store().byScope.s).toEqual([])
  })

  it('keeps scopes independent and clears one scope', () => {
    store().toggle('a', ['title:x'])
    store().toggle('b', ['title:y'])
    store().clear('a')
    expect(store().byScope.a).toEqual([])
    expect(store().byScope.b).toHaveLength(1)
  })

  it('seeds a list once and never overrides later choices', () => {
    store().seed('s', 'list-1', [['title:a'], ['title:b']])
    store().toggle('s', ['title:a'])
    store().seed('s', 'list-1', [['title:a'], ['title:b']])
    expect((store().byScope.s ?? []).map((keys) => keys[0])).toEqual(['title:b'])
    store().seed('s', 'list-2', [['title:c']])
    expect((store().byScope.s ?? []).map((keys) => keys[0])).toEqual(['title:b', 'title:c'])
  })

  it('selects and deselects groups of papers', () => {
    store().setMany('s', [['title:a'], ['title:b'], ['title:c']], true)
    store().setMany('s', [['title:b']], false)
    expect((store().byScope.s ?? []).map((keys) => keys[0])).toEqual(['title:a', 'title:c'])
  })
})
