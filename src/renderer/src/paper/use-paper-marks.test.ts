import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { flushPaperMarks, usePaperMarks } from './use-paper-marks'
import { newPaperHighlight, usePaperMarksStore } from './paper-marks-store'

afterEach(() => {
  vi.unstubAllGlobals()
  usePaperMarksStore.setState({ workspaceRoot: '', unitDir: '', items: [], cards: {}, removedIds: [], dirty: false })
})

describe('flushPaperMarks', () => {
  it('writes pending edits for the unit that still owns the store', async () => {
    const mark = newPaperHighlight({ color: 'yellow', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: 'q' })
    const paperMarksWrite = vi.fn(async () => ({ ok: true as const, items: [mark] }))
    vi.stubGlobal('window', { kunGui: { paperMarksWrite } })
    usePaperMarksStore.setState({ workspaceRoot: '/lib', unitDir: 'papers/a', items: [mark], removedIds: ['gone'], dirty: true })

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
    usePaperMarksStore.setState({ workspaceRoot: '/lib', unitDir: 'papers/b', dirty: true })
    await flushPaperMarks('/lib', 'papers/a')
    usePaperMarksStore.setState({ workspaceRoot: '/lib', unitDir: 'papers/a', dirty: false })
    await flushPaperMarks('/lib', 'papers/a')
    expect(paperMarksWrite).not.toHaveBeenCalled()
  })
  it('does not write or merge marks across libraries with the same relative unit path', async () => {
    let finish: (value: unknown) => void = () => undefined
    const pending = new Promise((resolve) => { finish = resolve })
    const mark = newPaperHighlight({ color: 'yellow', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: 'private A' })
    const paperMarksWrite = vi.fn(() => pending)
    vi.stubGlobal('window', { kunGui: { paperMarksWrite } })
    usePaperMarksStore.setState({ workspaceRoot: '/other', unitDir: 'papers/a', items: [mark], dirty: true })
    await flushPaperMarks('/lib', 'papers/a')
    expect(paperMarksWrite).not.toHaveBeenCalled()
    usePaperMarksStore.setState({ workspaceRoot: '/lib', unitDir: 'papers/a', items: [mark], dirty: true })
    const saving = flushPaperMarks('/lib', 'papers/a')
    usePaperMarksStore.setState({ workspaceRoot: '/other', unitDir: 'papers/a', items: [], dirty: false })
    finish({ ok: true, items: [mark] })
    await saving
    expect(usePaperMarksStore.getState().items).toEqual([])
    expect(usePaperMarksStore.getState().workspaceRoot).toBe('/other')
  })

  it('does not let the translated mirror reset or flush the primary viewer marks', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const mark = newPaperHighlight({ color: 'yellow', page: 1, rects: [[0, 0, 0.1, 0.1]], quote: 'unsaved primary' })
    const paperMarksRead = vi.fn(), paperMarksWrite = vi.fn()
    vi.stubGlobal('window', { kunGui: { paperMarksRead, paperMarksWrite } })
    usePaperMarksStore.setState({ workspaceRoot: '/lib', unitDir: 'papers/a', items: [mark], dirty: true })
    function Mirror() { usePaperMarks('/lib', 'papers/a', false); return null }
    let tree: ReturnType<typeof create> | undefined
    await act(async () => { tree = create(createElement(Mirror)) })
    expect(usePaperMarksStore.getState().items).toEqual([mark])
    expect(usePaperMarksStore.getState().dirty).toBe(true)
    await act(async () => tree?.unmount())
    expect(paperMarksRead).not.toHaveBeenCalled()
    expect(paperMarksWrite).not.toHaveBeenCalled()
  })

})
