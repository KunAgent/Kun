import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPaperMarks } from './use-paper-marks'
import { newPaperHighlight, usePaperMarksStore } from './paper-marks-store'

afterEach(() => {
  vi.unstubAllGlobals()
  usePaperMarksStore.setState({ unitDir: '', items: [], cards: {}, removedIds: [], dirty: false })
})

describe('flushPaperMarks', () => {
  it('writes pending edits for the unit that still owns the store', async () => {
    const mark = newPaperHighlight({ color: 'yellow', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: 'q' })
    const paperMarksWrite = vi.fn(async () => ({ ok: true as const, items: [mark] }))
    vi.stubGlobal('window', { kunGui: { paperMarksWrite } })
    usePaperMarksStore.setState({ unitDir: 'papers/a', items: [mark], removedIds: ['gone'], dirty: true })

    await flushPaperMarks('/lib', 'papers/a')

    expect(paperMarksWrite).toHaveBeenCalledWith({
      workspaceRoot: '/lib',
      unitDir: 'papers/a',
      items: [mark],
      removedIds: ['gone']
    })
    expect(usePaperMarksStore.getState().dirty).toBe(false)
  })

  it('skips clean stores and stores that belong to another unit', async () => {
    const paperMarksWrite = vi.fn()
    vi.stubGlobal('window', { kunGui: { paperMarksWrite } })
    usePaperMarksStore.setState({ unitDir: 'papers/b', dirty: true })
    await flushPaperMarks('/lib', 'papers/a')
    usePaperMarksStore.setState({ unitDir: 'papers/a', dirty: false })
    await flushPaperMarks('/lib', 'papers/a')
    expect(paperMarksWrite).not.toHaveBeenCalled()
  })
})
